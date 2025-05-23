import { WebRTCManager } from "./webRTCManager.js";

const websocketUrlInput = document.getElementById("websocketUrl");
const localPeerIdInput = document.getElementById("localPeerId");
const stunServerInput = document.getElementById("stunServer");
const connectWsBtn = document.getElementById("connectWsBtn");
const disconnectWsBtn = document.getElementById("disconnectWsBtn");

const refreshDevicesBtn = document.getElementById("refreshDevicesBtn");

const startMediaBtn = document.getElementById("startMediaBtn");
const stopMediaBtn = document.getElementById("stopMediaBtn");
const initiateOffersBtn = document.getElementById("initiateOffersBtn");
const closeWebRTCBtn = document.getElementById("closeWebRTCBtn");

const localVideoPlayer = document.getElementById("localVideoPlayer");
// const remoteVideosContainer = document.getElementById("remoteVideosContainer");

const dataChannelMessageInput = document.getElementById("dataChannelMessage");
const targetPeerIdInput = document.getElementById("targetPeerId");
const sendDataBtn = document.getElementById("sendDataBtn");

let webRTCManager;
let localStream;

// --- Utility Functions ---
function generatePeerId() {
  return "web-" + Math.random().toString(36).substring(2, 11);
}

// --- Initialization ---
localPeerIdInput.value = generatePeerId();

// --- Event Listeners ---
connectWsBtn.addEventListener("click", async () => {
  if (webRTCManager && webRTCManager.isWebSocketConnected) {
    console.warn("WebSocket already connected.");
    return;
  }

  const wsUrl = websocketUrlInput.value;
  const peerId = localPeerIdInput.value;
  const stunUrl = stunServerInput.value;

  if (!wsUrl || !peerId) {
    console.error("WebSocket URL and Peer ID are required.");
    return;
  }

  const uiConfig = {
    videoContainerId: "remoteVideosContainer",
    localVideoPlayerId: "localVideoPlayer", // Manager uses this to know where to put local stream if not handled by app
  };

  webRTCManager = new WebRTCManager(peerId, stunUrl, uiConfig);
  setupWebRTCManagerCallbacks();

  try {
    console.log(`Attempting to connect to WebSocket: ${wsUrl}`);
    // For this test, let's assume we want to send and receive audio/video by default
    await webRTCManager.connect(wsUrl, true, true);
    connectWsBtn.classList.add("hidden");
    disconnectWsBtn.classList.remove("hidden");
    initiateOffersBtn.classList.remove("hidden");
    closeWebRTCBtn.classList.remove("hidden");
    sendDataBtn.classList.remove("hidden");
  } catch (error) {
    console.error("Failed to connect WebSocket:", error);
    webRTCManager = null; // Clean up
  }
});

disconnectWsBtn.addEventListener("click", () => {
  if (webRTCManager) {
    webRTCManager.closeWebSocket(); // This should trigger onWebSocketConnection('closed')
    // Further UI cleanup might happen in the callback
  }
});

refreshDevicesBtn.addEventListener("click", async () => {
  const cameraSelect = document.getElementById("cameraSelect");
  const micSelect = document.getElementById("micSelect");

  // Clear current options
  cameraSelect.innerHTML = "";
  micSelect.innerHTML = "";

  let tempStream = null;

  try {
    // Prompt permissions (important for Firefox)
    tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });

    // Enumerate devices
    const devices = await navigator.mediaDevices.enumerateDevices();

    // Filter and populate camera options
    const videoDevices = devices.filter((device) => device.kind === "videoinput");
    videoDevices.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.text = device.label || `Camera ${index + 1}`;
      cameraSelect.appendChild(option);
    });

    // Filter and populate microphone options
    const audioDevices = devices.filter((device) => device.kind === "audioinput");
    audioDevices.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.text = device.label || `Microphone ${index + 1}`;
      micSelect.appendChild(option);
    });
  } catch (err) {
    console.error("Error accessing media devices.", err);
    alert("Please allow camera and microphone access to list devices.");
  } finally {
    // Stop all tracks and release camera/mic
    if (tempStream) {
      tempStream.getTracks().forEach((track) => track.stop());
      tempStream = null;
      console.log("Media tracks stopped and camera/mic released.");
    }
  }
});

startMediaBtn.addEventListener("click", async () => {
  if (localStream) {
    console.warn("Local media already started.");
    return;
  }
  try {
    console.log("Requesting local media (audio & video)...");
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideoPlayer.srcObject = localStream;
    localVideoPlayer.play().catch((e) => console.error("Local video play error:", e));

    if (webRTCManager) {
      webRTCManager.setLocalStream(localStream);
    }
    startMediaBtn.classList.add("hidden");
    stopMediaBtn.classList.remove("hidden");
    console.log("Local media started and set.");
  } catch (error) {
    console.error("Error starting local media:", error);
  }
});

stopMediaBtn.addEventListener("click", () => {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localVideoPlayer.srcObject = null;
    localStream = null;
    if (webRTCManager) {
      webRTCManager.setLocalStream(null); // Inform manager
    }
    stopMediaBtn.classList.add("hidden");
    startMediaBtn.classList.remove("hidden");
    console.log("Local media stopped.");
  }
});

initiateOffersBtn.addEventListener("click", () => {
  if (webRTCManager) {
    console.log("Manually initiating offers to all peers...");
    webRTCManager.initiateOffersToAllPeers();
  } else {
    console.warn("WebRTCManager not initialized.");
  }
});

closeWebRTCBtn.addEventListener("click", () => {
  if (webRTCManager) {
    webRTCManager.closeWebRTC(); // This also disposes remote media elements handled by manager
    console.log("WebRTC connections closed.");
    // No need to iterate remoteVideosContainer here if manager handles its elements
  }
});

sendDataBtn.addEventListener("click", () => {
  if (!webRTCManager || !webRTCManager.isWebSocketConnected) {
    console.warn("WebRTCManager not connected. Cannot send data.");
    return;
  }
  const message = dataChannelMessageInput.value;
  const targetId = targetPeerIdInput.value.trim();
  if (!message) {
    console.warn("Cannot send empty message.");
    return;
  }
  console.log(`Sending data: "${message}" to ${targetId || "ALL"}`);
  webRTCManager.sendViaDataChannel(message, targetId || null);
});

function setupWebRTCManagerCallbacks() {
  if (!webRTCManager) return;

  webRTCManager.onWebSocketConnection = (state) => {
    console.log(`WebSocket Connection State: ${state}`);
    if (state === "closed" || state === "error") {
      disconnectWsBtn.classList.add("hidden");
      connectWsBtn.classList.remove("hidden");
      initiateOffersBtn.classList.add("hidden");
      closeWebRTCBtn.classList.add("hidden");
      sendDataBtn.classList.add("hidden");
      // Optionally, clean up WebRTC resources if WebSocket drops unexpectedly
      // webRTCManager.closeWebRTC(); // This might be too aggressive depending on desired reconnect logic
    }
  };

  webRTCManager.onWebRTCConnection = (peerId) => {
    console.log(`WebRTC Connection established/completed with peer: ${peerId}`);
  };

  webRTCManager.onDataChannelConnection = (peerId) => {
    console.log(`Data Channel OPEN with peer: ${peerId}. Ready to send/receive data.`);
    // Example: Send a greeting
    // webRTCManager.sendViaDataChannel(`Hello ${peerId}, I'm ${localPeerIdInput.value}!`, peerId);
  };

  webRTCManager.onDataChannelMessageReceived = (message, peerId) => {
    console.log(`Message from ${peerId} (DataChannel): ${message}`);
    // Display the message somewhere in the UI if needed
  };

  webRTCManager.onVideoStreamEstablished = (peerId, stream) => {
    console.log(`Video stream established from peer: ${peerId}`);
    // The manager should have already created and attached the stream to a video element
    // in #remoteVideosContainer. If custom handling is needed, do it here.
    // Example: Check if the element exists
    const videoElement = document.getElementById(`video-${peerId}`);
    if (videoElement && videoElement.srcObject) {
      console.log(`Video element for ${peerId} is active.`);
    } else {
      console.warn(
        `Video element for ${peerId} not found or stream not set after onVideoStreamEstablished. videoElement: ${videoElement}, stream: ${stream}`
      );
    }
  };
  webRTCManager.onAudioStreamEstablished = (peerId, stream) => {
    console.log(`Audio stream established from peer: ${peerId}`);
    const audioElement = document.getElementById(`audio-${peerId}`);
    if (audioElement && audioElement.srcObject) {
      console.log(`Audio element for ${peerId} is active.`);
    } else {
      const videoElement = document.getElementById(`video-${peerId}`); // Check if audio is on video el
      if (videoElement && videoElement.srcObject && videoElement.srcObject.getAudioTracks().length > 0) {
        console.log(`Audio for ${peerId} is playing through its video element.`);
      } else {
        console.warn(`Audio element for ${peerId} not found or stream not set after onAudioStreamEstablished.`);
      }
    }
  };
}

// Initial state update for buttons
disconnectWsBtn.classList.add("hidden");
stopMediaBtn.classList.add("hidden");
initiateOffersBtn.classList.add("hidden");
closeWebRTCBtn.classList.add("hidden");
sendDataBtn.classList.add("hidden");

console.log("Test page initialized. Enter WebSocket URL and connect.");
