const fs = require("fs")
const events = require("events")
const WebSocket = require("ws")

const pairingPayload = require("./pairingPayload.json");

const lgtv = new events.EventEmitter()
let requestId = 0
let lgtvSocket
let pointerSocket
let waitingForResponse = {}
let subscribtions = {}
let keyFile = "./client-key"

const onConnected = () => {
  lgtv.emit("connected")
  if (fs.existsSync(keyFile)) {
    pairingPayload["client-key"] = fs.readFileSync(keyFile, "utf8");
  }
  lgtvSocket.send(JSON.stringify({
    type: "register",
    payload: pairingPayload,
  }))
}

const onClosed = () => {
  lgtv.emit("close")
  subscribtions = {}
  waitingForResponse = {}
  lgtvSocket.removeListener("open", onConnected)
  lgtvSocket.removeListener("close", onClosed)
  lgtvSocket.removeListener("error", onError)
  lgtvSocket.removeListener("message", onMessage)
  lgtvSocket = undefined
}

const onError = (error) => lgtv.emit("error", error)

const onRegistered = (payload) => {
  lgtv.emit("registered")
  if (pairingPayload["client-key"] === undefined) {
    fs.writeFile(keyFile, payload["client-key"], (err) => {
      if (err) {
        lgtv.emit("error", new Error(err))
      }
    })
  }
}

const onMessage = (message) => {
  if (waitingForResponse[message.id] !== undefined) {
    // TODO: Reject on error response
    waitingForResponse[message.id].resolve(message.payload)
    delete waitingForResponse[message.id]
  } else if (subscribtions[message.id] !== undefined) {
    // TODO: Remove subscribtion on error response?
    subscribtions[message.id](message.payload)
  }
}

lgtv.connect = ({host, port, clientKeyFile}) => {
  lgtv.emit("connecting")
    keyFile = clientKeyFile
  lgtvSocket = new WebSocket(`lgtvSockets://${host}:${port || 3000}`, { rejectUnauthorized: false })
  lgtvSocket.on("open", onConnected)
  lgtvSocket.on("close", onClosed)
  lgtvSocket.on("error", onError)
  lgtvSocket.on("message", (data) => {
    let message;
    try {
      message = JSON.parse(data);
    } catch (e) {
      lgtv.emit("error", new Error(e));
      return;
    }
    if (message.type === "registered") {
      onRegistered(message.payload)
    } else {
      onMessage(message)
    }
  })
}

lgtv.close = function close() {
  if (lgtvSocket && lgtvSocket.readyState !== WebSocket.CLOSED) {
    lgtvSocket.terminate()
  }
};

lgtv.request = (data) => new Promise((resolve, reject) => {
    if (lgtvSocket === undefined || lgtvSocket.readyState !== WebSocket.OPEN) {
      reject(new Error("Not connected."))
      return
    }
    if (typeof data === "string") {
      data = { uri: data }
    }
    data.type = "request"
    data.id = (requestId += 1)
    data.payload = data.payload || {}
    lgtvSocket.send(JSON.stringify(data), (error) => {
      if (error) reject(error)
      else waitingForResponse[data.id] = {resolve, reject, time: new Date()}
    })
})

lgtv.subscribe = (data, callback) => {
    if (lgtvSocket === undefined || lgtvSocket.readyState !== WebSocket.OPEN) {
      reject(new Error("Not connected."))
      return
    }
    if (typeof data === "string") {
      data = { uri: data }
    }
    data.type = "subscribe"
    data.id = (requestId += 1)
    data.payload = data.payload || {}
    lgtvSocket.send(JSON.stringify(data), (error) => {
      if (error) lgtv.emit("error", new Error(error))
      else subscribtions[data.id] = callback
    })
}

// Pointer Input

const getPointerInputSocket = () => new Promise(async (resolve, reject) => {
  if (pointerSocket && pointerSocket.readyState === WebSocket.OPEN) {
    resolve(pointerSocket)
    return
  }

  const onError = (error) => {
    pointerSocket.removeListener("open", onOpen)
    pointerSocket.removeListener("error", onError)
    reject(error)
  }

  const onOpen = () => {
    pointerSocket.removeListener("open", onOpen)
    pointerSocket.removeListener("error", onError)
    resolve(pointerSocket)
  }

  const onClosed = () => {
    pointerSocket.removeListener("close", onClosed)
    pointerSocket = undefined
  }

  try {
    const response = await lgtv.request("ssap://com.webos.service.networkinput/getPointerInputSocket")
    pointerSocket = new WebSocket(response.socketPath, { rejectUnauthorized: false })
    pointerSocket.on("open", onOpen)
    pointerSocket.on("error", onError)
    pointerSocket.on("close", onClosed)
  } catch (error) {
    reject(error)
  }
})

lgtv.button = (button) => new Promise(async (resolve, reject) => {
  try {
    socket = await getPointerInputSocket()
    socket.send(`type:button\nname:${button}\n\n`, (error) => {
      if (error) reject (error)
      else resolve()
    })
  } catch (error) {
    reject(error)
  }
})

lgtv.move = (x, y) => new Promise(async (resolve, reject) => {
  try {
    socket = await getPointerInputSocket()
    socket.send(`type:move\ndx:${x}\ndy:${y}\ndown:0\n\n`, (error) => {
      if (error) reject (error)
      else resolve()
    })
  } catch (error) {
    reject(error)
  }
})

lgtv.scroll = (value) => new Promise(async (resolve, reject) => {
  try {
    socket = await getPointerInputSocket()
    socket.send(`type:scroll\ndx:0\ndy:${value}\ndown:0\n\n`, (error) => {
      if (error) reject (error)
      else resolve()
    })
  } catch (error) {
    reject(error)
  }
})

module.exports = lgtv
