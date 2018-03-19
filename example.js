const lgtv = require("./lgtv");

lgtv.connect({
  host: "10.0.0.4",
  clientKeyFile: "./client-key.txt",
});

lgtv.on("connect", () => {
  console.log("connected to lgtv but pairing not done");
});

lgtv.on("registered", async () => {
  console.log("registered to lgtv - pairing ok");
  try {
    // Switch to youtube app
    const res = await lgtv.request({ uri: "ssap://com.webos.applicationManager/launch", payload: { id: "youtube.leanback.v4" } })
    console.log("log:debug", "LGTV response:", res);

    // Send the home button
    await lgtv.move("HOME")
  } catch (error) {
    console.log("Error from lgtv:", error)
  }

  // Subscribe to changes
  lgtv.subscribe({ uri: "ssap://com.webos.service.mrcu/sensor/getSensorData" }, (res) => {
    console.log(`Received response: ${JSON.stringify(res)}`);
  });

  lgtv.subscribe({ uri: "ssap://com.webos.applicationManager/getForegroundAppInfo" }, (res) => {
    console.log(`Received response: ${JSON.stringify(res)}`);
  });

  lgtv.subscribe("ssap://audio/getVolume", (res) => {
    console.log(`Received response: ${JSON.stringify(res)}`);

    if (res.changed && res.changed.indexOf("volume") >= 0) {
      console.log(`Volume changed: ${res.cause}`);
      lgtv.close(); // Will reconnect after 5 seconds since reconnect is true
    }
    if (res.changed && res.changed.indexOf("muted") >= 0) {
      console.log(`Mute changed: ${res.muted}`);
    }
  });
});

lgtv.on("close", () => {
  console.log("disconnected from lgtv");
});

lgtv.on("error", (error) => {
  console.log("error from lgtv", error);
});
