# 🌐 Simple WebRTC Signaling & Streaming UI WebClient (JavaScript + Unity Compatible)

This project provides a full WebRTC signaling and streaming test harness, designed to work **with or without Unity**, using a browser-based interface. It works especially well with the [SimpleWebRTC](https://assetstore.unity.com/packages/tools/network/simplewebrtc-309727) Unity asset, allowing you to **bypass Unity’s native media streaming** and use **standard WebRTC-compatible streams** from any device!

✅ **Works with Chrome, Firefox, Edge, and Unity WebRTC (via SimpleWebRTC)**  
🔁 **Handles connect/disconnect cycles cleanly**  
🎙️ **Supports media selection (camera/mic), video/audio streaming, and data channels**  
🎥 **Works on desktop and mobile browsers! (check WebRTC support, before using!)**

![image](https://github.com/user-attachments/assets/a88c5f69-ec41-4e4a-93f7-1b5998b63257)

---

## ✨ Features

- Connect to a signaling server via WebSocket
- Send and receive video/audio streams to/from any WebRTC peer
- Query and switch between available cameras and microphones
- Manually start/stop local media streams
- Send messages over WebRTC data channels
- Automatically manages remote video/audio elements
- Compatible with Unity (via [SimpleWebRTC](https://assetstore.unity.com/packages/tools/network/simplewebrtc-309727))

---

## 📦 Setup

Clone or copy the HTML and JS files into your local project, then open `index.html` in your browser.

Make sure your WebSocket signaling server (e.g. the SimpleWebRTC demo server) is running.

---

## 🚀 Quick Start

```html
<!-- Connect and stream -->
<input id="websocketUrl" placeholder="wss://your-signaling-server" />
<input id="localPeerId" placeholder="peer-id" />
<input id="stunServer" value="stun:stun.l.google.com:19302" />
<button id="connectWsBtn">Connect</button>
<button id="startMediaBtn">Start Camera & Mic</button>
<video id="localVideoPlayer" autoplay muted playsinline></video>
````

```js
// Initializes a unique peer ID
localPeerIdInput.value = "web-" + Math.random().toString(36).substring(2, 11);

// Connect to WebSocket signaling server
connectWsBtn.addEventListener("click", async () => {
  const wsUrl = websocketUrlInput.value;
  const peerId = localPeerIdInput.value;
  const stunUrl = stunServerInput.value;

  const uiConfig = {
    videoContainerId: "remoteVideosContainer",
    localVideoPlayerId: "localVideoPlayer",
  };

  webRTCManager = new WebRTCManager(peerId, stunUrl, uiConfig);
  await webRTCManager.connect(wsUrl, true, true);
});
```

---

## 📘 API Overview

### `WebRTCManager(peerId, stunUrl, uiConfig)`

Initializes the manager.

* `peerId` — Unique ID for this client
* `stunUrl` — STUN server (e.g. `"stun:stun.l.google.com:19302"`)
* `uiConfig` — Object with:

  * `localVideoPlayerId`: DOM ID for local video preview
  * `videoContainerId`: DOM ID where remote video/audio elements are appended

---

### `connect(wsUrl, useAudio, useVideo)`

Connects to the WebSocket server and initializes WebRTC settings.

---

### `setLocalStream(stream | null)`

* Starts streaming if a valid `MediaStream` is passed
* Stops streaming and removes all tracks if `null`

---

### `initiateOffersToAllPeers()`

Initiates new WebRTC offers to all currently connected peers.

---

### `sendViaDataChannel(message, peerId?)`

Sends data to one peer (`peerId`) or all peers if `peerId` is `null`.

---

### Callbacks

* `onWebSocketConnection(state)` – "connected", "closed", or "error"
* `onWebRTCConnection(peerId)` – Called when WebRTC completes with a peer
* `onDataChannelConnection(peerId)` – Data channel opened
* `onDataChannelMessageReceived(message, peerId)` – Message received
* `onVideoStreamEstablished(peerId, stream)`
* `onAudioStreamEstablished(peerId, stream)`

---

## 🎥 Media Device Management

You can refresh available devices with a button:

```js
await navigator.mediaDevices.enumerateDevices();
```

The script will:

* List all cameras (`videoinput`) and microphones (`audioinput`)
* Populate them in dropdowns
* Prompt permissions if needed
* Release the media after scanning (`getTracks().forEach(track => track.stop())`)

---

## 🧩 Unity Integration

This interface works beautifully with the [SimpleWebRTC](https://assetstore.unity.com/packages/tools/network/simplewebrtc-309727) Unity asset.

### Why Use This?

You can **bypass any native video/audio capture** or **content streaming** and use **standard browser APIs** for full control. Stream from:

* External webcams
* Virtual devices
* Phones/tablets with better browser support
* XR devices (Meta, HTC, ...)

No need to compile new Unity plugins — just connect to the same signaling server and use standard WebRTC.

---

## 📄 License

MIT License. Use freely in personal or commercial projects.

---

## 🙌 Acknowledgements

Thanks to:

* [SimpleWebRTC](https://assetstore.unity.com/packages/tools/network/simplewebrtc-309727) Unity
* The WebRTC and MediaDevices APIs

---

## 📬 Questions or Issues?

Create an issue or pull request on GitHub.

Happy streaming! 🚀
