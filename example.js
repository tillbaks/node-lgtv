const lgtv = require("./lgtv");

lgtv.connect({
  host: "10.0.0.101",
  port: 3000,
  reconnect: true,
  reconnectSleep: 5000,
  clientKeyFile: "./client-key.txt",
});

lgtv.on("connect", () => {
  console.log("connected to lgtv!");
});

lgtv.on("close", () => {
  console.log("disconnected from lgtv");
});

lgtv.on("error", (error) => {
  console.log("error from lgtv");
  console.log(error);
});

// Requests and subscriptions are put in a queue and
// run when connection is available
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
