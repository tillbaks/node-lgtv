const fs = require("fs");
const events = require("events");

const WebSocket = require("ws");
const async = require("async");

const LGTV = new events.EventEmitter();
let requestId = 0;
let ws;

const pairingPayload = require("./pairingPayload.json");

const sentMessages = {};
const callbacks = {};
const messageQueue = async.queue((msg, done) => {
  const data = msg;
  requestId += 1;
  data.id = data.id || requestId;
  sentMessages[data.id] = data;
  callbacks[data.id] = (response) => {
    if (data.type === "request") {
      delete sentMessages[response.id];
      delete callbacks[response.id];
    }
    data.callback(response.payload);
  };
  ws.send(JSON.stringify(data));
  done();
}, 1);
messageQueue.pause();

LGTV.request = function request(data, cb) {
  messageQueue.push({
    type: data.type || "request",
    id: data.id,
    uri: data.uri || data,
    payload: data.payload || {},
    callback: data.callback || cb,
  });
};

LGTV.subscribe = function subscribe(data, cb) {
  messageQueue.push({
    type: data.type || "subscribe",
    id: data.id,
    uri: data.uri || data,
    payload: data.payload || {},
    callback: data.callback || cb,
  });
};

LGTV.connect = function connect({
  host = "lgwebostv", port = 3000,
  reconnect = false, reconnectSleep = 5000,
  clientKeyFile = "./client-key",
} = {}) {
  ws = new WebSocket(`ws://${host}:${port}`);

  // Once connected to TV - need to register to be able to send commands
  ws.on("open", () => {
    if (fs.existsSync(clientKeyFile)) {
      pairingPayload["client-key"] = fs.readFileSync(clientKeyFile, "utf8");
    }
    ws.send(JSON.stringify({
      type: "register",
      payload: pairingPayload,
    }));
  });

  ws.on("close", () => {
    messageQueue.pause();
    LGTV.emit("close");
    if (reconnect) {
      setTimeout(() => {
        LGTV.connect({
          host, port, reconnect, reconnectSleep, clientKeyFile,
        });
      }, reconnectSleep);
    }
  });

  ws.on("error", (err) => {
    messageQueue.pause();
    LGTV.emit("error", new Error(err));
  });

  ws.on("message", (data) => {
    let jsonData;
    try {
      jsonData = JSON.parse(data);
    } catch (e) {
      LGTV.emit("error", new Error(e));
      return;
    }
    if (jsonData.type === "registered") {
      LGTV.emit("connect");
      if (pairingPayload["client-key"] === undefined) {
        console.log(jsonData);
        fs.writeFile(clientKeyFile, jsonData.payload["client-key"], (err) => {
          if (err) {
            LGTV.emit("error", new Error(err));
          }
        });
      }
      messageQueue.resume();
      Object.keys(sentMessages).forEach((id) => {
        LGTV.subscribe(sentMessages[id]); // Need to subcribe again if re-connection happened
      });
    } else if (sentMessages[jsonData.id] !== undefined) {
      callbacks[jsonData.id](jsonData);
    }
  });
};

LGTV.close = function close() {
  ws.close();
};

module.exports = LGTV;
