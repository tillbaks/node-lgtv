const fs = require("fs");
const events = require("events");

const WebSocket = require("ws");
const async = require("async");

const LGTV = new events.EventEmitter();
let requestId = 0;
let ws;
let wsInput;

const pairingPayload = require("./pairingPayload.json");

const sentMessages = {};
const callbacks = {};
const messageQueue = async.queue((msg, done) => {
  const data = msg;
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
  if (typeof data !== "string" && data.type === "button") {
    if (wsInput) wsInput.send(`type:${data.type}\nname:${data.name}\n\n`);
    if (cb) cb();
  } else {
    messageQueue.push({
      type: "request",
      id: data.id || (requestId += 1),
      uri: data.uri || data,
      payload: data.payload || {},
      callback: data.callback || cb,
    });
  }
};

LGTV.subscribe = function subscribe(data, cb) {
  messageQueue.push({
    type: "subscribe",
    id: data.id || (requestId += 1),
    uri: data.uri || data,
    payload: data.payload || {},
    callback: data.callback || cb,
  });
};

LGTV.options = {
  host: "lgwebostv",
  port: 3001,
  reconnect: false,
  reconnectSleep: 5000,
  clientKeyFile: "./client-key",
};

LGTV.connect = function connect({
  host = LGTV.options.host, port = LGTV.options.port,
  reconnect = LGTV.options.reconnect, reconnectSleep = LGTV.options.reconnectSleep,
  clientKeyFile = LGTV.options.clientKeyFile,
} = {}) {
  ws = new WebSocket(`wss://${host}:${port}`, { rejectUnauthorized: false });

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
      messageQueue.resume();
      LGTV.request("ssap://com.webos.service.networkinput/getPointerInputSocket", (res) => {
        wsInput = new WebSocket(res.socketPath, { rejectUnauthorized: false });
        wsInput.on("open", () => {
          LGTV.emit("connect");
        });
        wsInput.on("error", (err) => {
          messageQueue.pause();
          LGTV.emit("error", new Error(err));
          LGTV.close();
        });
        wsInput.on("close", () => {
          LGTV.close();
        });
        wsInput.on("message", msg => console.log(msg));
      });
      if (pairingPayload["client-key"] === undefined) {
        fs.writeFile(clientKeyFile, jsonData.payload["client-key"], (err) => {
          if (err) {
            LGTV.emit("error", new Error(err));
          }
        });
      }
      Object.keys(sentMessages).forEach((id) => {
        LGTV.subscribe(sentMessages[id]); // Need to subcribe again if re-connection happened
      });
    } else if (sentMessages[jsonData.id] !== undefined) {
      callbacks[jsonData.id](jsonData);
    }
  });
};

LGTV.close = function close() {
  if (ws) {
    ws.close();
  }
};

module.exports = LGTV;
