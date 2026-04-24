import AgoraRTC from "agora-rtc-sdk-ng";

// ENV (Vite)
export const APP_ID =
  import.meta.env?.VITE_AGORA_APP_ID ||
  "54993db7874e4d318e89c32e13de8f4a";

console.log("Agora APP_ID:", APP_ID);

export const createClient = () => {
  if (!APP_ID || APP_ID === "undefined") {
    throw new Error("Agora APP_ID is not configured");
  }

  return AgoraRTC.createClient({
    mode: "live",
    codec: "vp8",
  });
};

export const createTracks = async () => {
  try {
    const tracks = await AgoraRTC.createMicrophoneAndCameraTracks();
    return tracks; // [audio, video]
  } catch (error) {
    console.error("Failed to create tracks:", error);
    throw new Error(`Media access failed: ${error.message}`);
  }
};