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
    console.error("[agora] Missing env vars: AGORA_APP_ID or AGORA_APP_CERTIFICATE");
    return res.status(500).json({ error: "Agora env missing" });
  }

  // Unique UID per request to avoid conflicts
  const uid = Math.floor(Math.random() * 100000) + 1;
  const expirationTimeInSeconds = 3600; // 1 hour
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpireTime = currentTimestamp + expirationTimeInSeconds;

  const agoraRole =
    role === "publisher" ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;

  try {
    const token = RtcTokenBuilder.buildTokenWithUid(
      appID,
      appCertificate,
      channelName,
      uid,
      agoraRole,
      privilegeExpireTime
    );

    console.log(`[agora] Token generated for channel=${channelName} role=${role} uid=${uid}`);
    return res.json({ token, uid, appID });
  } catch (err) {
    console.error("[agora] Token generation error:", err);
    return res.status(500).json({ error: "Token generation failed" });
  }
});

module.exports = router;