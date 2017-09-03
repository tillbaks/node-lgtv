"use strict";

var WebSocket = require("ws");
var async = require("async");
var events = require("events");
var fs = require("fs");
var LGTV = new events.EventEmitter();
var request_id = 0;
var config = {
  host: "lgwebostv",
  port: 3000,
  reconnect: false,
  reconnect_sleep: 5000
};
var ws;

var pairing_payload = require('./pairing_payload.json');

var sent_messages = {};
var callbacks = {};
var message_queue = async.queue(function (data, cb) {
  sent_messages[data.id] = data;
  callbacks[data.id] = function (response) {
    if (data.type === "request") {
      delete sent_messages[response.id];
      delete callbacks[response.id];
    }
    data.callback(response.payload);
  };
  LGTV.send(data);
  cb();
}, 1);
message_queue.pause();

LGTV.send = function (payload) {
  ws.send(JSON.stringify(payload));
};

LGTV.register = function () {
  LGTV.send({
    "type": "register",
    "payload": pairing_payload
  });
};

LGTV.request = function (data, cb) {
  message_queue.push({
    "type": data.type || "request",
    "id": data.id || ++request_id,
    "uri": data.uri || data,
    "payload": data.payload || {},
    "callback": data.callback || cb
  });
};

LGTV.subscribe = function (data, cb) {
  message_queue.push({
    "type": data.type || "subscribe",
    "id": data.id || ++request_id,
    "uri": data.uri || data,
    "payload": data.payload || {},
    "callback": data.callback || cb
  });
};

LGTV.set_client_key = function (key) {
  pairing_payload["client-key"] = key;
  fs.writeFile("./pairing_payload.json", JSON.stringify(pairing_payload), function (err) {
    if (err) {
      LGTV.emit("error", new Error(err));
    }
  });
};

LGTV.set_config = function (conf) {
  if (conf.host !== undefined) { config.host = conf.host; }
  if (conf.port !== undefined) { config.port = conf.port; }
  if (conf.reconnect !== undefined) { config.reconnect = conf.reconnect; }
  if (conf.reconnect_sleep !== undefined) { config.reconnect_sleep = conf.reconnect_sleep; }
};

LGTV.connect = function (conf) {

  if (conf !== undefined) { LGTV.set_config(conf); }

  ws = new WebSocket("ws://" + config.host + ":" + config.port);

  ws.on("open", function onConnect() {
    LGTV.register();
  });

  ws.on("close", function onClose() {
    message_queue.pause();
    LGTV.emit("close");
    if (config.reconnect) {
      setTimeout(function () {
        LGTV.connect(config);
      }, config.reconnect_sleep);
    }
  });

  ws.on("error", function onError(err) {
    message_queue.pause();
    LGTV.emit("error", new Error(err));
  });

  ws.on("message", function onData(data) {
    try {
      data = JSON.parse(data);
    } catch (e) {
      return;
    }
    if (data.type === "registered") {
      LGTV.emit("connect");
      if (pairing_payload["client-key"] === undefined) {
        LGTV.set_client_key(data["payload"]["client-key"]);
      }
      message_queue.resume();
      Object.keys(sent_messages).forEach(function (id) {
        LGTV.subscribe(sent_messages[id]); // Need to subcribe again if re-connection happened
      });
    } else if (sent_messages[data.id] !== undefined) {
      callbacks[data.id](data);
    }
  });
};

LGTV.close = function () {
  ws.close();
};

module.exports = LGTV;
