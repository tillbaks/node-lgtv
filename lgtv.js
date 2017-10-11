const fs = require("fs");
const events = require("events");

const WebSocket = require("ws");
const async = require("async");

const LGTV = new events.EventEmitter();
let requestId = 0;
let ws;
let wsSpecial;

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
const specialQueue = async.queue((msg, done) => {
  wsSpecial.send(msg.data);
  if (msg.callback) { msg.callback(); }
  done();
}, 1);

messageQueue.pause();
specialQueue.pause();

LGTV.request = function request(data, cb) {
  if (typeof data === "string") {
    messageQueue.push({
      type: "request",
      id: (requestId += 1),
      uri: data,
      payload: {},
      callback: cb,
    });
  } else if (!data.type || data.type === "request") {
    messageQueue.push({
      type: "request",
      id: data.id || (requestId += 1),
      uri: data.uri,
      payload: data.payload || {},
      callback: data.callback || cb,
    });
  } else {
    let sendData = `type:${data.type}`;
    if (data.type === "button") {
      sendData += `\nname:${data.name}`;
    } else if (data.type === "move") {
      const [dx, dy] = data.value.split(",");
      sendData += `\ndx:${dx}\ndy:${dy}\ndown:0`;
    } else if (data.type === "scroll") {
      sendData += `\ndx:0\ndy:${data.value}\ndown:0`;
    }
    sendData += "\n\n";
    specialQueue.push({
      type: "specialSocket",
      data: sendData,
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

const config = {
  host: "lgwebostv",
  port: 3001,
  reconnect: false,
  reconnectSleep: 5000,
  clientKeyFile: "./client-key",
};

LGTV.setConfig = ({
  host = config.host, port = config.port,
  reconnect = config.reconnect, reconnectSleep = config.reconnectSleep,
  clientKeyFile = config.clientKeyFile,
} = config) => {
  config.host = host;
  config.port = port;
  config.reconnect = reconnect;
  config.reconnectSleep = reconnectSleep;
  config.clientKeyFile = clientKeyFile;
  return config;
};

LGTV.connect = function connect(...args) {
  const {
    host, port, reconnect, reconnectSleep, clientKeyFile,
  } = LGTV.setConfig(args);
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
    specialQueue.pause();
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
    specialQueue.pause();
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
        wsSpecial = new WebSocket(res.socketPath, { rejectUnauthorized: false });
        wsSpecial.on("open", () => {
          specialQueue.resume();
          LGTV.emit("connect");
        });
        wsSpecial.on("error", (err) => {
          specialQueue.pause();
          LGTV.emit("error", new Error(err));
          LGTV.close();
        });
        wsSpecial.on("close", () => {
          specialQueue.pause();
          LGTV.close();
        });
        wsSpecial.on("message", msg => console.log(msg));
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

  messageQueue.pause();
  specialQueue.pause();
};

module.exports = LGTV;
