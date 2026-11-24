import { describe, it, expect, vi } from "vitest";
import { parsePrivatePhotoRef, privatePhotoRef, isPrivatePhotoRef } from "@/lib/private-photos";
import { externalPhotoUrls, resolveImagesForOpenAI } from "@/lib/private-photos-server";
import { storagePath, PRIVATE_PATH_MARK } from "@/lib/photo-cleanup";
import { isUsersPhotoUrl } from "@/lib/jobs/server";

const U = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-2222-3333-4444-555555555555";

describe("private photo links", () => {
  it("round-trips and rejects odd paths", () => {
    const ref = privatePhotoRef(`${U}/123-abc.jpg`);
    expect(parsePrivatePhotoRef(ref)).toEqual({ userId: U, path: `${U}/123-abc.jpg` });
    expect(isPrivatePhotoRef(`/api/photos/${U}/../x.jpg`)).toBe(false);
    expect(isPrivatePhotoRef(`/api/photos/not-a-uuid/x.jpg`)).toBe(false);
    expect(isPrivatePhotoRef("https://example.com/x.jpg")).toBe(false);
  });

  it("is accepted only for its owner by the queue", () => {
    expect(isUsersPhotoUrl(`/api/photos/${U}/a.jpg`, U)).toBe(true);
    expect(isUsersPhotoUrl(`/api/photos/${U}/a.jpg`, OTHER)).toBe(false);
  });

  it("maps to the private bucket for cleanup", () => {
    expect(storagePath(`/api/photos/${U}/a.jpg`, "https://p.supabase.co")).toBe(`${PRIVATE_PATH_MARK}${U}/a.jpg`);
  });
});

describe("externalPhotoUrls", () => {
  const signer = vi.fn(async (paths: string[]) => paths.map((p) => `https://p.supabase.co/storage/v1/object/sign/photos-private/${p}?token=t`));
  it("signs private links, keeps public ones, drops other sellers' links", async () => {
    const out = await externalPhotoUrls(
      ["https://p.supabase.co/storage/v1/object/public/photos/x.jpg", `/api/photos/${U}/a.jpg`, `/api/photos/${OTHER}/b.jpg`],
      60, U, signer,
    );
    expect(out).toEqual(["https://p.supabase.co/storage/v1/object/public/photos/x.jpg", `https://p.supabase.co/storage/v1/object/sign/photos-private/${U}/a.jpg?token=t`]);
  });
  it("leaves analysis images alone when there are no private links", async () => {
    const imgs = [{ url: "https://p.supabase.co/storage/v1/object/public/photos/x.jpg" }];
    expect(await resolveImagesForOpenAI(imgs, U, signer)).toBe(imgs);
  });
});
