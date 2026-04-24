import AgoraRTC from "agora-rtc-sdk-ng";

export const APP_ID = "54993db7874e4d318e89c32e13de8f4a";

export const createClient = () =>
  AgoraRTC.createClient({ mode: "live", codec: "vp8" });

export const createTracks = async () => {
  const micTrack = await AgoraRTC.createMicrophoneAudioTrack();
  const camTrack = await AgoraRTC.createCameraVideoTrack();
  return [micTrack, camTrack];
};