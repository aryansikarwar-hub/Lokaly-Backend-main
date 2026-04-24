// const router = require('express').Router();
// router.post("/token", (req, res) => {
//   const { channelName, role } = req.body || {};

//   if (!channelName || typeof channelName !== "string") {
//     return res.status(400).json({ error: "channelName required" });
//   }

//   const appID = process.env.AGORA_APP_ID;
//   const appCertificate = process.env.AGORA_APP_CERTIFICATE;

//   if (!appID || !appCertificate) {
//     return res.status(500).json({ error: "Agora env missing" });
//   }

//   const uid = 0;
//   const tokenExpireTimeInSeconds = 3600;
//   const privilegeExpireTimeInSeconds = 3600;
//   const agoraRole = role === "publisher" ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;

//   try {
//     const token = RtcTokenBuilder.buildTokenWithUid(
//       appID,
//       appCertificate,
//       channelName,
//       uid,
//       agoraRole,
//       tokenExpireTimeInSeconds,
//       privilegeExpireTimeInSeconds
//     );

//     return res.json({ token });
//   } catch (err) {
//     console.error("Agora token error:", err);
//     return res.status(500).json({ error: "Token generation failed" });
//   }
// });
const router = require("express").Router();
const { RtcTokenBuilder, RtcRole } = require("agora-access-token");

router.post("/token", (req, res) => {
  const { channelName, role } = req.body || {};

  if (!channelName || typeof channelName !== "string") {
    return res.status(400).json({ error: "channelName required" });
  }

  const appID = process.env.AGORA_APP_ID;
  const appCertificate = process.env.AGORA_APP_CERTIFICATE;

  if (!appID || !appCertificate) {
    return res.status(500).json({ error: "Agora env missing" });
  }

  const uid = 0;
  const expirationTimeInSeconds = 3600;
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpireTime =
    currentTimestamp + expirationTimeInSeconds;

  const agoraRole =
    role === "publisher"
      ? RtcRole.PUBLISHER
      : RtcRole.SUBSCRIBER;

  try {
    const token = RtcTokenBuilder.buildTokenWithUid(
      appID,
      appCertificate,
      channelName,
      uid,
      agoraRole,
      privilegeExpireTime
    );

    return res.json({ token });
  } catch (err) {
    console.error("Agora token error:", err);
    return res.status(500).json({ error: "Token generation failed" });
  }
});

module.exports = router;