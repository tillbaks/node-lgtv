"use strict";
var util = require("util"),
  lgtv = require("./lgtv");

lgtv.connect({
  host: "10.0.0.101",
  port: 3000,
  reconnect: true,
  reconnect_sleep: 5000
});

lgtv.on("connect", function () {
  console.log("connected to lgtv!");
});

lgtv.on("close", function () {
  console.log("disconnected from lgtv");
});

lgtv.on("error", function (error) {
  console.log("error from lgtv");
  console.log(error);
});

// Requests and subscriptions are put in a queue and
// run when connection is available

lgtv.request("ssap://audio/getVolume", function (res) {
  console.log("Received response: " + JSON.stringify(res));
});

lgtv.subscribe("ssap://audio/getVolume", function (res) {
  console.log("Received response: " + JSON.stringify(res));

  if (res.changed && res.changed.indexOf("volume") >= 0) {
    console.log("volume changed: " + res.cause);
    lgtv.close(); // Will reconnect after 5 seconds
  }
  if (res.changed && res.changed.indexOf("muted") >= 0) {
    console.log("mute changed to: " + res.muted);
  }

});
