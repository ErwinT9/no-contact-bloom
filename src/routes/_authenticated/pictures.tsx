import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, ImagePlus, Lock, Pencil, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { AppShell } from "@/components/AppShell";
import { SoftCard } from "@/components/SoftCard";
import { PicturesIllustration } from "@/components/illustrations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { localId, pictureRepo } from "@/data/repository";
import type { Picture } from "@/data/types";
import { useAuth } from "@/hooks/useAuth";
import { activity } from "@/lib/badgeActivity";
import { humanizeError } from "@/lib/analytics";
import { supabase } from "@/integrations/supabase/client";
import { haptic } from "@/lib/native/haptics";
import { isNative } from "@/lib/native/platform";
import { pickImageSource } from "@/lib/avatar";
import { connectGoogleDrive, drive } from "@/lib/drive/client";
import { fileToDataUrl, toPictureDataUrl } from "@/lib/drive/image";
import { openExternalUrl } from "@/lib/openExternal";

const BUCKET = "activity-pictures";

export const Route = createFileRoute("/_authenticated/pictures")({
  head: () => ({
    meta: [
      { title: "Pictures | STEADY" },
      {
        name: "description",
        content: "Save the photos that remind you why you're staying strong — kept in your own Google Drive.",
      },
      { property: "og:title", content: "Pictures | STEADY" },
      { property: "og:description", content: "A private album for your reset." },
    ],
  }),
  component: Pictures,
});

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function Pictures() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingCaption, setEditingCaption] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const pictures = useQuery({
    queryKey: ["pictures", userId],
    queryFn: () => pictureRepo.list(userId),
    enabled: Boolean(userId),
  });

  const rows = pictures.data ?? [];
  const legacyRows = rows.filter((row) => row.storage_kind !== "drive" && row.image_url);
  const driveRows = rows.filter((row) => row.storage_kind === "drive" && row.drive_file_id);

  const status = useQuery({
    queryKey: ["drive-status", userId],
    queryFn: () => drive.status(),
    enabled: Boolean(userId),
    staleTime: 60_000,
  });
  const connected = Boolean(status.data?.connected);
  const reconnectRequired = Boolean(status.data?.reconnectRequired);

  /** Signed links for the older pictures that still live on STEADY's servers. */
  const legacySigned = useQuery({
    queryKey: ["pictures-signed", userId, legacyRows.map((row) => row.image_url).join("|")],
    enabled: Boolean(userId) && legacyRows.length > 0,
    queryFn: async () => {
      const paths = legacyRows.map((row) => row.image_url).filter(Boolean);
      if (paths.length === 0) return {} as Record<string, string>;
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const item of data ?? []) {
        if (item.path && item.signedUrl) map[item.path] = item.signedUrl;
      }
      return map;
    },
  });

  /** Drive images, fetched once through STEADY's server on the user's behalf. */
  const driveImages = useQuery({
    queryKey: ["pictures-drive", userId, driveRows.map((row) => row.drive_file_id).join("|")],
    enabled: Boolean(userId) && connected && driveRows.length > 0,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const map: Record<string, string> = {};
      for (const row of driveRows) {
        if (!row.drive_file_id) continue;
        try {
          const result = await drive.get(row.drive_file_id);
          if (result.dataUrl) map[row.drive_file_id] = result.dataUrl;
        } catch {
          // A single unreadable file must not blank the whole album.
        }
      }
      return map;
    },
  });

  function sourceFor(picture: Picture): string | undefined {
    if (picture.storage_kind === "drive") {
      return picture.drive_file_id ? driveImages.data?.[picture.drive_file_id] : undefined;
    }
    return legacySigned.data?.[picture.image_url];
  }

  const connect = useMutation({
    mutationFn: async () => connectGoogleDrive(),
    onMutate: () => setConnecting(true),
    onSettled: () => setConnecting(false),
    onSuccess: async () => {
      haptic.success();
      toast.success(t("pictures.connected"));
      await queryClient.invalidateQueries({ queryKey: ["drive-status", userId] });
      await queryClient.invalidateQueries({ queryKey: ["pictures-drive", userId] });
    },
    onError: (error) => toast.error(humanizeError(error)),
  });

  const disconnect = useMutation({
    mutationFn: async () => drive.disconnect(),
    onSuccess: async () => {
      toast.success(t("pictures.disconnected"));
      await queryClient.invalidateQueries({ queryKey: ["drive-status", userId] });
    },
    onError: (error) => toast.error(humanizeError(error)),
  });

  const upload = useMutation({
    mutationFn: async (dataUrl: string) => {
      const compact = await toPictureDataUrl(dataUrl);
      const result = await drive.upload(compact, `steady-${localId()}.jpg`);
      if (result.reconnectRequired || !result.fileId) {
        throw new Error(t("pictures.reconnectBody"));
      }
      return pictureRepo.save(userId, {
        image_url: "",
        caption: caption.trim() || null,
        storage_kind: "drive",
        drive_file_id: result.fileId,
        drive_web_link: result.webViewLink ?? null,
      });
    },
    onSuccess: async (next) => {
      activity.featureUsed("pictures");
      queryClient.setQueryData(["pictures", userId], next);
      setCaption("");
      haptic.success();
      toast.success(t("pictures.savedToAlbum"));
      await queryClient.invalidateQueries({ queryKey: ["pictures-drive", userId] });
    },
    onError: (error) => toast.error(humanizeError(error)),
  });

  const saveCaption = useMutation({
    mutationFn: async ({ picture, next }: { picture: Picture; next: string }) =>
      pictureRepo.save(userId, { ...picture, caption: next.trim() || null }),
    onSuccess: (next) => {
      queryClient.setQueryData(["pictures", userId], next);
      setEditingCaption(null);
      toast.success(t("pictures.captionSaved"));
    },
    onError: (error) => toast.error(humanizeError(error)),
  });

  const remove = useMutation({
    mutationFn: async (picture: Picture) => {
      if (picture.storage_kind === "drive") {
        if (picture.drive_file_id) await drive.remove(picture.drive_file_id);
      } else if (picture.image_url) {
        await supabase.storage.from(BUCKET).remove([picture.image_url]);
      }
      return pictureRepo.remove(userId, picture.id);
    },
    onSuccess: (next) => {
      queryClient.setQueryData(["pictures", userId], next);
      setOpenId(null);
    },
    onError: (error) => toast.error(humanizeError(error)),
  });

  function startAdd() {
    haptic.light();
    if (isNative()) {
      void pickImageSource().then((source) => {
        if (source) upload.mutate(source);
      });
      return;
    }
    fileInput.current?.click();
  }

  const openPicture = rows.find((row) => row.id === openId) ?? null;

  return (
    <AppShell title={t("pictures.title")} subtitle={t("pictures.subtitle")}>
      <PicturesIllustration className="mx-auto mb-5 mt-1 w-40" />

      {connected && !reconnectRequired ? (
        <SoftCard className="space-y-3">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="size-3.5 shrink-0" aria-hidden />
            {t("pictures.privacyBadge")}
          </p>
          <Input
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder={t("pictures.captionPlaceholder")}
            className="h-12 rounded-2xl"
          />
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) upload.mutate(await fileToDataUrl(file));
            }}
          />
          <Button className="press h-12 w-full rounded-2xl" disabled={upload.isPending} onClick={startAdd}>
            <ImagePlus className="mr-2 size-4" aria-hidden />
            {upload.isPending ? t("pictures.uploading") : t("pictures.addPicture")}
          </Button>
          <button
            type="button"
            onClick={() => disconnect.mutate()}
            className="press w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            {t("pictures.disconnect")}
          </button>
        </SoftCard>
      ) : (
        <SoftCard className="space-y-3">
          <h2 className="text-base font-semibold">{t("pictures.connectTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("pictures.connectBody")}</p>
          <p className="text-sm text-muted-foreground">{t("pictures.connectBodyStorage")}</p>
          {reconnectRequired ? (
            <p className="text-sm text-muted-foreground">{t("pictures.reconnectBody")}</p>
          ) : null}
          <Button
            className="press h-12 w-full rounded-2xl"
            disabled={connecting}
            onClick={() => connect.mutate()}
          >
            {connecting
              ? t("pictures.connecting")
              : reconnectRequired
                ? t("pictures.reconnectButton")
                : t("pictures.connectButton")}
          </Button>
        </SoftCard>
      )}

      {rows.length === 0 ? (
        <p className="mt-5 px-1 text-sm text-muted-foreground">{t("pictures.noPictures")}</p>
      ) : (
        <ul className="mt-5 grid grid-cols-2 gap-3">
          {rows.map((picture) => {
            const src = sourceFor(picture);
            return (
              <li key={picture.id} className="soft-card overflow-hidden rounded-3xl">
                <button
                  type="button"
                  className="press block w-full text-left"
                  onClick={() => {
                    setOpenId(picture.id);
                    setEditingCaption(null);
                  }}
                >
                  {src ? (
                    <img
                      src={src}
                      alt={picture.caption ?? t("pictures.savedPicture")}
                      loading="lazy"
                      className="aspect-square w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center bg-muted px-3 text-center text-[11px] text-muted-foreground">
                      {picture.storage_kind === "drive" && !connected
                        ? t("pictures.privacyBadge")
                        : t("pictures.unavailableOffline")}
                    </div>
                  )}
                  <div className="space-y-1 p-3">
                    <p className="text-[11px] text-muted-foreground">
                      {formatDate(picture.created_at)}
                    </p>
                    {picture.caption ? (
                      <p className="min-w-0 text-xs break-words">{picture.caption}</p>
                    ) : null}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {openPicture ? (
        <div className="fixed inset-0 z-[2147483000] flex flex-col bg-background/95 backdrop-blur-sm">
          <div className="flex items-center justify-end p-3">
            <button
              type="button"
              aria-label={t("pictures.close")}
              onClick={() => setOpenId(null)}
              className="press rounded-full bg-muted p-2 text-foreground"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center px-4">
            {sourceFor(openPicture) ? (
              <img
                src={sourceFor(openPicture)}
                alt={openPicture.caption ?? t("pictures.savedPicture")}
                className="max-h-full max-w-full rounded-2xl object-contain"
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t("pictures.unavailableOffline")}</p>
            )}
          </div>
          <div className="space-y-3 p-4 pb-8">
            <p className="text-xs text-muted-foreground">
              {t("pictures.dateAdded", { date: formatDate(openPicture.created_at) })}
            </p>
            {editingCaption === null ? (
              openPicture.caption ? (
                <p className="text-sm break-words">{openPicture.caption}</p>
              ) : null
            ) : (
              <div className="space-y-2">
                <Input
                  value={editingCaption}
                  onChange={(event) => setEditingCaption(event.target.value)}
                  placeholder={t("pictures.captionPlaceholder")}
                  className="h-12 rounded-2xl"
                />
                <Button
                  className="press h-11 w-full rounded-2xl"
                  disabled={saveCaption.isPending}
                  onClick={() =>
                    saveCaption.mutate({ picture: openPicture, next: editingCaption })
                  }
                >
                  {t("pictures.saveCaption")}
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                className="press h-11 flex-1 rounded-2xl"
                onClick={() => setEditingCaption(openPicture.caption ?? "")}
              >
                <Pencil className="mr-2 size-4" aria-hidden />
                {t("pictures.editCaption")}
              </Button>
              {openPicture.drive_web_link ? (
                <Button
                  variant="secondary"
                  className="press h-11 flex-1 rounded-2xl"
                  onClick={() => void openExternalUrl(openPicture.drive_web_link!)}
                >
                  <ExternalLink className="mr-2 size-4" aria-hidden />
                  {t("pictures.openInDrive")}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                className="press h-11 w-full rounded-2xl text-destructive"
                disabled={remove.isPending}
                onClick={() => remove.mutate(openPicture)}
              >
                <Trash2 className="mr-2 size-4" aria-hidden />
                {t("pictures.deletePicture")}
              </Button>
            </div>
            <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Lock className="size-3.5 shrink-0" aria-hidden />
              {openPicture.storage_kind === "drive"
                ? t("pictures.privacyNote")
                : t("pictures.onSteadyServers")}
            </p>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
