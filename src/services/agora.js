import AgoraRTC from "agora-rtc-sdk-ng";

// Use environment variable in production - fallback for local dev only
export const APP_ID = import.meta.env?.VITE_AGORA_APP_ID || "54993db7874e4d318e89c32e13de8f4a";

export const createClient = () => {
  if (!APP_ID) {
    throw new Error("Agora APP_ID is not configured");
  }
  return AgoraRTC.createClient({ mode: "live", codec: "vp8" });
};

export const createTracks = async () => {
  try {
    const micTrack = await AgoraRTC.createMicrophoneAudioTrack();
    const camTrack = await AgoraRTC.createCameraVideoTrack();
    return [micTrack, camTrack];
  } catch (error) {
    console.error("Failed to create tracks:", error);
    throw new Error(`Media access failed: ${error.message}`);
  }
};