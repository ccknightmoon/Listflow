import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        background: "#185FA5",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "7px",
      }}
    >
      <span style={{ color: "white", fontSize: 16, fontWeight: 700, letterSpacing: -0.5 }}>LF</span>
    </div>,
    { ...size }
  );
}
