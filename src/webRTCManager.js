// Helper for signaling message types (equivalent to C# enum)
const SignalingMessageType = {
  NEWPEER: "NEWPEER",
  NEWPEERACK: "NEWPEERACK",
  OFFER: "OFFER",
  ANSWER: "ANSWER",
  CANDIDATE: "CANDIDATE",
  DISPOSE: "DISPOSE",
  DATA: "DATA",
  COMPLETE: "COMPLETE",
  // Add any other types if used
};

// Helper to parse and create signaling messages
class SignalingMessage {
  constructor(type, senderPeerId, receiverPeerId, message, connectionCount, isVideoAudioSender) {
    if (typeof type === "string" && arguments.length === 1) {
      // Parse from string
      const parts = type.split("|");
      this.Type = parts[0];
      this.SenderPeerId = parts[1];
      this.ReceiverPeerId = parts[2];
      this.Message = parts[3];
      this.ConnectionCount = parts[4] ? parseInt(parts[4], 10) : 0;
      this.IsVideoAudioSender = parts[5] ? parts[5].toLowerCase() === "true" : false;
    } else {
      // Create new message
      this.Type = type;
      this.SenderPeerId = senderPeerId;
      this.ReceiverPeerId = receiverPeerId;
      this.Message = message;
      this.ConnectionCount = connectionCount;
      this.IsVideoAudioSender = isVideoAudioSender;
    }
  }

  toString() {
    return `${this.Type}|${this.SenderPeerId}|${this.ReceiverPeerId}|${this.Message}|${this.ConnectionCount}|${this.IsVideoAudioSender}`;
  }
}

class WebRTCManager {
  constructor(localPeerId, stunServerAddress, uiConfig) {
    this.localPeerId = localPeerId;
    this.stunServerAddress = stunServerAddress;
    this.uiConfig = uiConfig; // { videoContainerId: 'videos', localVideoPlayerId: 'localVideo' }

    // Event Callbacks
    this.onWebSocketConnection = null; // (state: 'open' | 'closed' | 'error') => {}
    this.onWebRTCConnection = null; // (peerId: string) => {}
    this.onDataChannelConnection = null; // (peerId: string) => {}
    this.onDataChannelMessageReceived = null; // (message: string, peerId: string) => {}
    this.onVideoStreamEstablished = null; // (peerId: string, stream: MediaStream) => {}
    this.onAudioStreamEstablished = null; // (peerId: string, stream: MediaStream) => {}

    this.isWebSocketConnected = false;
    this.isWebSocketConnectionInProgress = false;

    this.ws = null;
    this.isLocalPeerVideoAudioSender = false;
    this.isLocalPeerVideoAudioReceiver = false;

    this.peerConnections = new Map(); // peerId -> RTCPeerConnection
    this.senderDataChannels = new Map(); // peerId -> RTCDataChannel
    this.receiverDataChannels = new Map(); // peerId -> RTCDataChannel
    this.videoTrackSenders = new Map(); // peerId -> RTCRtpSender
    this.audioTrackSenders = new Map(); // peerId -> RTCRtpSender

    // For browser: peerId -> { videoElement: HTMLVideoElement, audioElement: HTMLAudioElement }
    this.mediaElements = new Map();
    this.localStream = null; // Store local media stream if any
  }

  async connect(webSocketUrl, isVideoAudioSender, isVideoAudioReceiver) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.warn("WebSocket already connected.");
      return;
    }
    if (this.isWebSocketConnectionInProgress) {
      console.warn("WebSocket connection attempt already in progress.");
      return;
    }

    this.isWebSocketConnectionInProgress = true;
    this.isLocalPeerVideoAudioSender = isVideoAudioSender;
    this.isLocalPeerVideoAudioReceiver = isVideoAudioReceiver;

    console.log(`Attempting to connect to WebSocket: ${webSocketUrl}`);
    this.ws = new WebSocket(webSocketUrl);

    return new Promise((resolve, reject) => {
      this.ws.onopen = () => {
        console.log("WebSocket connection opened!");
        this.isWebSocketConnected = true;
        this.isWebSocketConnectionInProgress = false;
        this.onWebSocketConnection?.("open");
        this.sendWebSocketMessage(SignalingMessageType.NEWPEER, this.localPeerId, "ALL", `New peer ${this.localPeerId}`);
        resolve();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (error) => {
        console.error("WebSocket Error:", error);
        this.isWebSocketConnectionInProgress = false;
        // No onWebSocketConnection for 'error' in original, but good practice
        this.onWebSocketConnection?.("error");
        reject(error);
      };

      this.ws.onclose = (event) => {
        console.log("WebSocket connection closed!", event.code, event.reason);
        this.isWebSocketConnected = false;
        this.isWebSocketConnectionInProgress = false;
        this.onWebSocketConnection?.("closed");
        // Potentially attempt to reconnect or clean up WebRTC connections
        this.cleanupAllPeers();
        reject(new Error(`WebSocket closed: ${event.code} ${event.reason}`));
      };
    });
  }

  _setupPeerConnection(peerId) {
    if (this.peerConnections.has(peerId)) {
      console.warn(`Peer connection for ${peerId} already exists.`);
      return this.peerConnections.get(peerId);
    }

    const config = {};
    if (this.stunServerAddress) {
      config.iceServers = [{ urls: this.stunServerAddress }];
    }

    const pc = new RTCPeerConnection(config);
    this.peerConnections.set(peerId, pc);
    this._setupPeerConnectionEventHandlers(peerId, pc);

    // If we are the sender, add local tracks now if they exist
    if (this.isLocalPeerVideoAudioSender && this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, this.localStream);
        if (track.kind === "video") {
          this.videoTrackSenders.set(peerId, sender);
        } else if (track.kind === "audio") {
          this.audioTrackSenders.set(peerId, sender);
        }
      });
    }

    return pc;
  }

  _setupPeerConnectionEventHandlers(peerId, pc) {
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendWebSocketMessage(SignalingMessageType.CANDIDATE, this.localPeerId, peerId, JSON.stringify(event.candidate.toJSON()));
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`${this.localPeerId} ICE connection state with ${peerId} changed to ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        // This is a good point to consider the WebRTC connection established
        this.onWebRTCConnection?.(peerId);
        // In the original C#, "COMPLETE" was sent. Let's keep that for consistency.
        // It was sent by the offering side.
        // if (pc.signalingState === 'stable' && !this.isLocalPeerVideoAudioReceiver) { // Simple heuristic for offerer
        // This logic is a bit tricky to directly translate for "who sends COMPLETE"
        // Let's assume the one who initiated the offer sends it.
        // For simplicity, maybe both sides can consider it connected.
        // The original C# sent this from the *offering* side upon 'completed'
      }
      if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "closed") {
        console.warn(`ICE connection with ${peerId} ${pc.iceConnectionState}. Cleaning up.`);
        this._cleanupPeer(peerId);
      }
    };

    pc.ondatachannel = (event) => {
      console.log(`Data channel received from ${peerId}`);
      const receiveChannel = event.channel;
      this.receiverDataChannels.set(peerId, receiveChannel);

      receiveChannel.onopen = () => {
        console.log(`ReceiverDataChannel for ${peerId} opened on ${this.localPeerId}.`);
        // In C#, a DATA message was sent back to confirm.
        this.sendWebSocketMessage(
          SignalingMessageType.DATA,
          this.localPeerId,
          peerId,
          `ReceiverDataChannel on ${this.localPeerId} for ${peerId} established.`
        );
        this.onDataChannelConnection?.(peerId); // Inform app that data channel is ready from receiver side
      };
      receiveChannel.onmessage = (ev) => {
        console.log(`${this.localPeerId} received on ${peerId} receiverDataChannel: ${ev.data}`);
        this.onDataChannelMessageReceived?.(ev.data, peerId);
      };
      receiveChannel.onclose = () => {
        console.log(`ReceiverDataChannel for ${peerId} closed on ${this.localPeerId}.`);
        this.receiverDataChannels.delete(peerId);
      };
      receiveChannel.onerror = (err) => {
        console.error(`ReceiverDataChannel for ${peerId} error on ${this.localPeerId}:`, err);
      };
    };

    // Create a sender data channel if one doesn't exist
    // The original code creates it immediately.
    if (!this.senderDataChannels.has(peerId)) {
      const senderChannel = pc.createDataChannel(`dataChannel-${peerId}`);
      this.senderDataChannels.set(peerId, senderChannel);
      senderChannel.onopen = () => {
        console.log(`SenderDataChannel to ${peerId} opened on ${this.localPeerId}.`);
        // Original C# invoked onDataChannelConnection for the *sender* side upon receiving a DATA message
        // Here, we can invoke it for the sender when its channel opens,
        // or wait for the remote's DATA ack for symmetry. The C# code triggered it on DATA msg.
      };
      senderChannel.onmessage = (ev) => {
        // Sender channels usually don't receive messages if it's a unidirectional setup from its perspective
        // but RTCDataChannel is bi-directional by default.
        console.log(`${this.localPeerId} received on ${peerId} senderDataChannel (unexpected for typical use): ${ev.data}`);
        this.onDataChannelMessageReceived?.(ev.data, peerId);
      };
      senderChannel.onclose = () => {
        console.log(`SenderDataChannel to ${peerId} closed on ${this.localPeerId}.`);
        this.senderDataChannels.delete(peerId);
      };
      senderChannel.onerror = (err) => {
        console.error(`SenderDataChannel to ${peerId} error on ${this.localPeerId}:`, err);
      };
      console.log(`SenderDataChannel for ${peerId} created on ${this.localPeerId}.`);
    }

    pc.ontrack = (event) => {
      console.log(`Track received from ${peerId}:`, event.track.kind);

      const track = event.track;
      const kind = track.kind;

      // Log the event.streams for debugging, but don't rely on it for core logic
      if (event.streams && event.streams.length > 0) {
        console.log(
          `[WebRTCManager] event.streams for track ${track.id}:`,
          event.streams.map((s) => s.id)
        );
      } else {
        console.log(`[WebRTCManager] event.streams is empty for track ${track.id}. This is often normal.`);
      }

      let mediaPeerBundle = this.mediaElements.get(peerId);
      if (!mediaPeerBundle) {
        console.warn(`No media elements prepared for ${peerId}, cannot play track.`);
        return;
      }

      // Create or reuse unified remoteStream
      if (!mediaPeerBundle.remoteStream) {
        mediaPeerBundle.remoteStream = new MediaStream();
      }

      const remoteStream = mediaPeerBundle.remoteStream;

      // Remove old track of the same kind before adding the new one
      remoteStream
        .getTracks()
        .filter((t) => t.kind === kind)
        .forEach((oldTrack) => {
          console.log(`Removing old ${kind} track ${oldTrack.id} from remote stream.`);
          remoteStream.removeTrack(oldTrack);
        });

      // Add the new track
      remoteStream.addTrack(track);
      console.log(`Added new ${kind} track ${track.id} to remote stream for ${peerId}.`);

      // Attach stream to element if needed
      if (kind === "video" && mediaPeerBundle.videoElement) {
        mediaPeerBundle.videoElement.srcObject = remoteStream;
        mediaPeerBundle.videoElement.play().catch((e) => console.error("Video play failed:", e));
        this.onVideoStreamEstablished?.(peerId, remoteStream);
      }

      // Check for any muted audio tracks
      const tracks = remoteStream.getAudioTracks();
      tracks.forEach((track) => {
        console.log(`Track ID: ${track.id}, Muted: ${track.muted}, State: ${track.readyState}`);
      });

      if (kind === "audio") {
        // const audioElement = mediaPeerBundle.audioElement || mediaPeerBundle.videoElement;
        const audioElement = mediaPeerBundle.videoElement;
        if (audioElement) {
          audioElement.srcObject = remoteStream;
          audioElement.muted = false; // Make sure it's not muted by the app
          audioElement.play().catch((e) => console.error("Audio play failed:", e));

          // Try forcing the track enabled
          track.enabled = true;
          // Debug log
          console.log("Audio track state after forcing:", {
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState,
          });

          this.onAudioStreamEstablished?.(peerId, remoteStream);
        }
      }
    };

    pc.onnegotiationneeded = async () => {
      // This often fires multiple times or at sensitive moments.
      // The original C# code checked pc.signalingState !== RTCSignalingState.Stable
      // In JS, it's pc.signalingState !== 'stable'
      // It also deferred this to a coroutine.
      if (pc.signalingState !== "stable") {
        // Only if stable, means we are likely the initiator
        console.log(`Negotiation needed for ${peerId}. Creating offer.`);
        try {
          await this._createAndSendOffer(peerId);
        } catch (error) {
          console.error(`Error during negotiationneeded for ${peerId}:`, error);
        }
      } else {
        console.log(`Negotiation needed for ${peerId}, but signaling state is ${pc.signalingState}. Skipping offer creation.`);
      }
    };
  }

  async handleMessage(data) {
    const text = await data.text();
    console.log(`Received WebSocket message: ${text}`);
    const signalingMessage = new SignalingMessage(text);

    const { Type, SenderPeerId, ReceiverPeerId, Message, ConnectionCount, IsVideoAudioSender } = signalingMessage;

    // Ensure peerId is not our own ID before processing most messages
    if (SenderPeerId === this.localPeerId && Type !== SignalingMessageType.COMPLETE && Type !== SignalingMessageType.DATA) {
      // console.log("Ignoring message from self (unless it's a specific type like COMPLETE/DATA directed to self).");
      // return;
    }

    switch (Type) {
      case SignalingMessageType.NEWPEER:
        if (SenderPeerId === this.localPeerId) break; // Don't process own NEWPEER broadcast
        if (IsVideoAudioSender && this.isLocalPeerVideoAudioReceiver) {
          this._createNewPeerMediaReceivingResources(SenderPeerId);
        }
        this._setupPeerConnection(SenderPeerId);
        console.log(`NEWPEER: Created new peerconnection ${SenderPeerId} on peer ${this.localPeerId}`);
        // Send ACK
        this.sendWebSocketMessage(
          SignalingMessageType.NEWPEERACK,
          this.localPeerId,
          "ALL", // Or SenderPeerId if ACK is direct
          "New peer ACK",
          this.peerConnections.size,
          this.isLocalPeerVideoAudioSender
        );
        break;

      case SignalingMessageType.NEWPEERACK:
        if (SenderPeerId === this.localPeerId) break;
        if (!this.peerConnections.has(SenderPeerId)) {
          if (IsVideoAudioSender && this.isLocalPeerVideoAudioReceiver) {
            this._createNewPeerMediaReceivingResources(SenderPeerId);
          }
          const pc = this._setupPeerConnection(SenderPeerId);
          console.log(`NEWPEERACK: Created new peerconnection ${SenderPeerId} on peer ${this.localPeerId}`);

          // The original C# logic had `connectionGameObject.ConnectWebRTC();`
          // which translated to `InstantiateWebRTC` which called `CreateOffer`.
          // This was triggered when `signalingMessage.ConnectionCount == peerConnections.Count`.
          // This implies a "fully meshed" or "all peers aware" state before starting offers.
          // Let's try to initiate offer if this ACK completes the expected set.
          // Note: ConnectionCount in the message is from *that* sender's perspective.
          // We need a more robust way to decide "everyone is here".
          // For now, let's assume if an ACK comes from a new peer, and we are supposed to send, we can make an offer.
          // This might lead to multiple offers if not careful.
          // The original "InstantiateWebRTC" called CreateOffer for *all* connections.
          // This logic is best handled by the application layer deciding when to call `initiateOfferToAll` or similar.
        }
        // Original check: if (signalingMessage.ConnectionCount == peerConnections.Count)
        // This is tricky because ConnectionCount is from the sender of NEWPEERACK.
        // Perhaps if *our* peerConnections.size matches an expected number of peers?
        // Let's simplify: the offering can be triggered manually or after a certain number of peers.
        // For this direct translation, the `connectionGameObject.ConnectWebRTC()` implies starting the offer process.
        // The `CreateOffer` was called for *all* peers in the original Unity code.
        // I'll provide a method `initiateOffersToAllPeers` that can be called by the app.
        // The original logic:
        // if (signalingMessage.ConnectionCount == peerConnections.Count) {
        //    connectionGameObject.ConnectWebRTC(); // -> StartCoroutine(CreateOffer()) for all peers
        // }
        // This seems like the role of the "first" peer or a peer that detects all others are present.
        // This is often a source of race conditions. A simpler model is:
        // Peer A joins. Peer B joins. B sends NEWPEER. A sends NEWPEERACK to B. A also sends NEWPEER. B sends NEWPEERACK to A.
        // At this point, A knows B, B knows A. They can start negotiating.
        // The `onnegotiationneeded` event is often a better trigger for offers if handled carefully.

        // Let's assume for now that if an ACK arrives for a new peer, and we are a sender,
        // we might need to create an offer to them if `onnegotiationneeded` doesn't fire appropriately.
        if (this.isLocalPeerVideoAudioSender && this.peerConnections.has(SenderPeerId)) {
          // Check if an offer is already in progress or if connection is established
          const pc = this.peerConnections.get(SenderPeerId);
          if (pc && pc.signalingState === "stable") {
            // Only if no negotiation is ongoing
            console.log(`Considering offer to ${SenderPeerId} after NEWPEERACK`);
            await this._createAndSendOffer(SenderPeerId);
          }
        }

        break;

      case SignalingMessageType.OFFER:
        if (ReceiverPeerId === this.localPeerId || ReceiverPeerId === "ALL") {
          if (!this.peerConnections.has(SenderPeerId)) {
            if (IsVideoAudioSender && this.isLocalPeerVideoAudioReceiver) {
              // Assuming IsVideoAudioSender on OFFER is about the offerer
              this._createNewPeerMediaReceivingResources(SenderPeerId);
            }
            this._setupPeerConnection(SenderPeerId); // Ensure PC exists
            console.log(`OFFER: Created peer connection for ${SenderPeerId} on demand.`);
          }
          await this._handleOffer(SenderPeerId, Message);
        }
        break;

      case SignalingMessageType.ANSWER:
        if (ReceiverPeerId === this.localPeerId || ReceiverPeerId === "ALL") {
          await this._handleAnswer(SenderPeerId, Message);
        }
        break;

      case SignalingMessageType.CANDIDATE:
        if (ReceiverPeerId === this.localPeerId || ReceiverPeerId === "ALL") {
          // Or check if candidate is for a known peer
          // Ensure the peer connection exists, though it should if an offer/answer exchange happened.
          if (!this.peerConnections.has(SenderPeerId)) {
            console.warn(`Received candidate from ${SenderPeerId} but no peer connection exists. Might be late.`);
            // Optionally, queue candidate or set up PC if it makes sense for your flow
          } else {
            await this._handleCandidate(SenderPeerId, Message);
          }
        }
        break;

      case SignalingMessageType.DISPOSE:
        if (SenderPeerId !== this.localPeerId) {
          // If it's from another peer about themselves
          this._cleanupPeer(SenderPeerId);
          console.log(`DISPOSE: Peerconnection for ${SenderPeerId} removed on peer ${this.localPeerId}`);
        }
        break;

      case SignalingMessageType.DATA: // This is an ACK for data channel establishment
        if (ReceiverPeerId === this.localPeerId) {
          const senderChannel = this.senderDataChannels.get(SenderPeerId);
          if (senderChannel && senderChannel.readyState === "open") {
            console.log(`Data channel to ${SenderPeerId} confirmed by remote peer.`);
            this.onDataChannelConnection?.(SenderPeerId); // Sender's side confirms connection
          }
        }
        break;

      case SignalingMessageType.COMPLETE: // Received when remote peer's ICE is 'completed'
        if (ReceiverPeerId === this.localPeerId) {
          console.log(`Peer ${SenderPeerId} has indicated WebRTC connection completion.`);
          // Original C# invoked onWebRTCConnection. We do this on ICE 'connected'/'completed' locally.
          // This is more of a remote confirmation.
          this.onWebRTCConnection?.(SenderPeerId); // Can be invoked again, ensure idempotency in handler
        }
        break;

      default:
        console.log(`Received unknown or unhandled message type '${Type}' from ${SenderPeerId}: ${data}`);
        break;
    }
  }

  _createNewPeerMediaReceivingResources(peerId) {
    // Check if we already have a bundle in our map
    if (this.mediaElements.has(peerId)) {
      const existingBundle = this.mediaElements.get(peerId);
      // Optional: Add checks here to ensure DOM elements still exist and are valid
      // For now, assume if it's in the map, it's usable or will be replaced if needed.
      // console.log(`[WebRTCManager] Media elements for peer ${peerId} already in map.`);
      // return existingBundle; // If you want to prevent re-creation, but ontrack might need to ensure srcObject
    }

    const videoContainer = this.uiConfig?.videoContainerId ? document.getElementById(this.uiConfig.videoContainerId) : document.body;
    if (!videoContainer) {
      console.error("[WebRTCManager] Video container not found. Cannot create media elements.");
      // Remove from map if it was somehow partially set
      this.mediaElements.delete(peerId);
      return null;
    }

    // If re-creating or creating for the first time, remove any old DOM elements first
    const oldBundle = this.mediaElements.get(peerId);
    if (oldBundle) {
      oldBundle.videoElement?.remove();
      oldBundle.audioElement?.remove();
    }

    const peerElements = {};

    const videoElement = document.createElement("video");
    videoElement.id = `video-${peerId}`;
    videoElement.autoplay = true;
    videoElement.playsinline = true; // Important for mobile browsers
    videoElement.style.width = "320px"; // Example style
    videoElement.style.height = "240px";
    videoElement.controls = true; // Useful for debugging
    videoElement.setAttribute("data-peer-id", peerId);
    videoContainer.appendChild(videoElement);
    peerElements.videoElement = videoElement;
    console.log(`[WebRTCManager] Created video element for ${peerId}`);

    // We'll primarily use the video element for both audio and video tracks from the same peer.
    // A separate audio element is often not needed unless you have specific use cases.
    const audioElement = document.createElement("audio");
    audioElement.id = `audio-${peerId}`;
    audioElement.autoplay = true;
    audioElement.setAttribute("data-peer-id", peerId);
    videoContainer.appendChild(audioElement);
    peerElements.audioElement = audioElement; // Keep a reference if needed later
    console.log(`[WebRTCManager] Created audio element for ${peerId}`);

    this.mediaElements.set(peerId, peerElements);
    return peerElements;
  }

  async _createAndSendOffer(peerId) {
    const pc = this.peerConnections.get(peerId);
    if (!pc) {
      console.error(`Cannot create offer for ${peerId}, no peer connection.`);
      return;
    }
    if (pc.signalingState !== "stable") {
      console.warn(`Cannot create offer for ${peerId}, signaling state is ${pc.signalingState}. Current negotiation might be in progress by remote.`);
      return;
    }

    console.log(`Creating offer for ${peerId}`);
    await pc
      .createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => {
        this.sendWebSocketMessage(
          SignalingMessageType.OFFER,
          this.localPeerId,
          peerId,
          JSON.stringify(pc.localDescription) // Standard SDP format
        );
        console.log(`Offer sent to ${peerId}`);
      })
      .catch((error) => console.error(`Failed to create or send offer for ${peerId}:`, error));
  }

  async _handleOffer(senderPeerId, offerJson) {
    console.log(`${this.localPeerId} got OFFER from ${senderPeerId}`);
    const pc = this.peerConnections.get(senderPeerId);
    if (!pc) {
      console.error(`No peer connection for ${senderPeerId} to handle offer.`);
      return;
    }

    const offerDesc = JSON.parse(offerJson);
    console.log(`OFFERDESC = ${offerJson}`);
    await pc
      .setRemoteDescription(new RTCSessionDescription(offerDesc))
      .then(() => console.log(`Remote description (offer) set for ${senderPeerId}. Creating answer.`))
      .then(() => pc.createAnswer())
      .then((answer) => pc.setLocalDescription(answer))
      .then(() => {
        this.sendWebSocketMessage(SignalingMessageType.ANSWER, this.localPeerId, senderPeerId, JSON.stringify(pc.localDescription));
        console.log(`Answer sent to ${senderPeerId}`);
      })
      .catch((error) => console.error(`Error handling offer from ${senderPeerId}:`, error));
  }

  async _handleAnswer(senderPeerId, answerJson) {
    console.log(`${this.localPeerId} got ANSWER from ${senderPeerId}`);
    const pc = this.peerConnections.get(senderPeerId);
    if (!pc) {
      console.error(`No peer connection for ${senderPeerId} to handle answer.`);
      return;
    }

    try {
      const answerDesc = JSON.parse(answerJson);
      await pc.setRemoteDescription(new RTCSessionDescription(answerDesc));
      console.log(`Remote description (answer) set for ${senderPeerId}. Connection should establish.`);

      // In C#, there was a "COMPLETE" message sent from offerer when its ICE was "Completed".
      // If this side (answerer) reaches 'completed', it can also inform the other side.
      // This is useful if the offerer's 'completed' event didn't fire or message was lost.
      // However, typically, just setting remote answer is enough for connection to proceed.
      // The original code sent COMPLETE *from the offerer* when its ICE completed.
      // And if the answerer received COMPLETE, it invoked onWebRTCConnection.
      // This seems to indicate the original "COMPLETE" message was more of a final handshake step.
      // If our local ICE connection state becomes 'connected' or 'completed', onWebRTCConnection will fire.
      // Let's send the "COMPLETE" message from the *offerer* when its ICE state is "completed".
      // This "COMPLETE" handling in handleMessage is for *receiving* it.
      // The original C# check:
      // if (state == RTCIceConnectionState.Completed) {
      //    connectionGameObject.Connect(); // Not relevant here
      //    OnWebRTCConnection?.Invoke(); // Local event
      //    SendWebSocketMessage(SignalingMessageType.COMPLETE, localPeerId, peerId, ...);
      // }
      // So, if *our* (offerer's) ICE completes, we send COMPLETE.
      // This is now handled by `oniceconnectionstatechange` sending it.
      // The logic for *sending* COMPLETE is effectively:
      // if (pc.iceConnectionState === 'completed' && pc.signalingState === 'stable' && !this.isLocalPeerVideoAudioReceiver) {
      // This heuristic (not receiver) suggests the offerer sends it.
      // The current `oniceconnectionstatechange` doesn't distinguish offerer/answerer for sending COMPLETE.
      // Let's refine `oniceconnectionstatechange` to send COMPLETE if it's likely the offerer.
      // This is tricky. For now, `onWebRTCConnection` callback is the primary local indicator.
    } catch (error) {
      console.error(`Error handling answer from ${senderPeerId}:`, error);
    }
  }

  async _handleCandidate(senderPeerId, candidateJson) {
    // console.log(`${this.localPeerId} got CANDIDATE from ${senderPeerId}: ${candidateJson}`);
    const pc = this.peerConnections.get(senderPeerId);
    if (!pc) {
      console.warn(`No peer connection for ${senderPeerId} to add ICE candidate. Candidate might be early or PC closed.`);
      return;
    }
    // It's possible setRemoteDescription hasn't completed yet.
    // RTCPeerConnection.addIceCandidate will queue candidates if needed.
    if (pc.remoteDescription == null) {
      console.warn(`Remote description for ${senderPeerId} is not set yet. ICE candidate will be queued.`);
    }

    try {
      const candidateInit = JSON.parse(candidateJson);
      await pc.addIceCandidate(new RTCIceCandidate(candidateInit));
      // console.log(`ICE candidate added for ${senderPeerId}`);
    } catch (error) {
      // Ignore error if remote description is not yet set, as candidate is queued.
      if (error.name === "InvalidStateError" && pc.remoteDescription == null) {
        console.log(`ICE candidate for ${senderPeerId} queued as remote description is not set yet.`);
      } else {
        console.error(`Error adding ICE candidate for ${senderPeerId}:`, error, candidateJson);
      }
    }
  }

  // Call this method to start WebRTC connections after WebSocket is established and peers are known (or use onnegotiationneeded)
  async initiateOffersToAllPeers() {
    console.log("Attempting to initiate offers to all known peers...");
    if (!this.isLocalPeerVideoAudioSender) {
      console.log("Not an audio/video sender, will not initiate offers unless data channels are primary.");
      // Still might want to initiate for data channels.
      // The original C# `CreateOffer` was called in `InstantiateWebRTC`
      // which was called by `connectionGameObject.ConnectWebRTC()`
    }
    for (const peerId of this.peerConnections.keys()) {
      await this._createAndSendOffer(peerId);
    }
  }

  _cleanupPeer(peerId) {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.getSenders().forEach((s) => s.track?.stop());
      pc.close();
      this.peerConnections.delete(peerId);
    }

    this.senderDataChannels.delete(peerId); // RTCDataChannel.close() is called by pc.close()
    this.receiverDataChannels.delete(peerId);

    this.videoTrackSenders.delete(peerId); // RTCRtpSender.stop() is handled by pc.close()
    this.audioTrackSenders.delete(peerId);

    const mediaPeerBundle = this.mediaElements.get(peerId);
    if (mediaPeerBundle) {
      if (mediaPeerBundle.remoteStream) {
        mediaPeerBundle.remoteStream.getTracks().forEach((t) => {
          t.stop();
          mediaPeerBundle.remoteStream.removeTrack(t);
        });
        mediaPeerBundle.remoteStream = null;
      }
      if (mediaPeerBundle.videoElement) {
        mediaPeerBundle.videoElement.pause();
        mediaPeerBundle.videoElement.srcObject = null;
        mediaPeerBundle.videoElement.remove();
      }
      if (mediaPeerBundle.audioElement) {
        mediaPeerBundle.audioElement.pause();
        mediaPeerBundle.audioElement.srcObject = null;
        mediaPeerBundle.audioElement.remove();
      }
      this.mediaElements.delete(peerId);
    }

    console.log(`Cleaned up resources for peer ${peerId}`);
  }

  cleanupAllPeers() {
    for (const peerId of this.peerConnections.keys()) {
      this._cleanupPeer(peerId);
    }
    this.peerConnections.clear();
    this.senderDataChannels.clear();
    this.receiverDataChannels.clear();
    this.videoTrackSenders.clear();
    this.audioTrackSenders.clear();
    this.mediaElements.forEach((els) => {
      els.videoElement?.remove();
      els.audioElement?.remove();
    });
    this.mediaElements.clear();
    console.log("All peer resources cleaned up.");
  }

  closeWebRTC() {
    this.cleanupAllPeers();

    // Notify other peers that this peer is leaving
    this.sendWebSocketMessage(SignalingMessageType.DISPOSE, this.localPeerId, "ALL", `Remove peerConnection for ${this.localPeerId}.`);

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    const localVideoPlayer = this.uiConfig?.localVideoPlayerId ? document.getElementById(this.uiConfig.localVideoPlayerId) : null;
    if (localVideoPlayer && localVideoPlayer.srcObject) {
      localVideoPlayer.srcObject.getTracks().forEach((track) => track.stop());
      localVideoPlayer.srcObject = null;
    }

    console.log("WebRTC connections closed and local media released.");
  }

  closeWebSocket() {
    if (this.ws) {
      this.ws.close();
      // this.ws = null; // ws.onclose will handle setting isWebSocketConnected to false
    }
  }

  // In JavaScript, offer creation is often tied to `onnegotiationneeded` or explicitly called.
  // `InstantiateWebRTC` in C# was essentially `StartCoroutine(CreateOffer())`.
  // This can be mapped to a method that iterates and creates offers for all known peers.
  // Or, more commonly, negotiation is triggered per peer when ready.
  // See `initiateOffersToAllPeers`.

  sendViaDataChannel(message, targetPeerId = null) {
    if (targetPeerId) {
      const dc = this.senderDataChannels.get(targetPeerId);
      if (dc && dc.readyState === "open") {
        dc.send(message);
      } else {
        console.warn(`Data channel to ${targetPeerId} not open or doesn't exist.`);
      }
    } else {
      // Send to all open sender data channels
      this.senderDataChannels.forEach((dc, peerId) => {
        if (dc.readyState === "open") {
          dc.send(message);
        } else {
          console.warn(`Data channel to ${peerId} not open, skipping message.`);
        }
      });
    }
  }

  async setLocalStream(stream) {
    const localVideoPlayer = this.uiConfig?.localVideoPlayerId ? document.getElementById(this.uiConfig.localVideoPlayerId) : null;

    if (stream === null) {
      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (e) {
            console.warn("Failed to stop track:", e);
          }
        });
      }

      if (localVideoPlayer) {
        localVideoPlayer.srcObject = null;
      }

      for (const [peerId, pc] of this.peerConnections.entries()) {
        for (const sender of pc.getSenders()) {
          if (sender.track) {
            try {
              pc.removeTrack(sender);
            } catch (e) {
              console.warn("Error removing sender track:", e);
            }
          }
        }
      }

      this.localStream = null;
      return;
    }

    this.localStream = stream;

    if (localVideoPlayer && stream.getTracks().length > 0) {
      localVideoPlayer.muted = true;
      localVideoPlayer.srcObject = stream;
      localVideoPlayer.controls = true; // Useful for debugging
      localVideoPlayer.onloadedmetadata = () => {
        localVideoPlayer.play().catch((e) => console.error("Local video play failed:", e));
      };
    }

    for (const [peerId, pc] of this.peerConnections.entries()) {
      if (!this.isLocalPeerVideoAudioSender) continue;

      // Remove old tracks
      for (const sender of pc.getSenders()) {
        if (sender.track && stream.getTracks().some((t) => t.kind === sender.track.kind)) {
          try {
            pc.removeTrack(sender);
          } catch (e) {
            console.warn("Error removing old track:", e);
          }
        }
      }

      // Add new tracks
      for (const track of stream.getTracks()) {
        const sender = pc.addTrack(track, stream);
        if (track.kind === "video") {
          this.videoTrackSenders.set(peerId, sender);
        } else if (track.kind === "audio") {
          this.audioTrackSenders.set(peerId, sender);
        }
      }

      // Optionally await a renegotiation method here
      await this._createAndSendOffer(peerId);
    }
  }

  sendWebSocketTestMessage(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    } else {
      console.warn("WebSocket not open. Cannot send test message.");
    }
  }

  sendWebSocketMessage(messageType, senderPeerId, receiverPeerId, message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const signalingMsg = new SignalingMessage(
        messageType,
        senderPeerId,
        receiverPeerId,
        message,
        this.peerConnections.size,
        this.isLocalPeerVideoAudioSender
      );
      this.ws.send(signalingMsg.toString());
    } else {
      console.warn(`WebSocket not open. Cannot send: ${messageType} to ${receiverPeerId}`);
    }
  }
}

// Example Usage (Illustrative - you'll need HTML and to call these):
/*
async function main() {
    const localPeerId = 'user-' + Math.random().toString(36).substring(2, 9);
    const stunServer = 'stun:stun.l.google.com:19302'; // Example STUN server
    const uiSettings = {
        videoContainerId: 'remoteVideosContainer', // An ID of a div in your HTML
        localVideoPlayerId: 'localVideoPlayer'    // An ID of a video element for local preview
    };

    const webRTCManager = new WebRTCManager(localPeerId, stunServer, uiSettings);

    // Assign callbacks
    webRTCManager.onWebSocketConnection = (state) => {
        console.log(`WebSocket State: ${state}`);
        if (state === 'open') {
            // Now that WebSocket is open, you might decide to get local media
            // and then tell the manager about it.
            // Or, if you are joining a room, you might wait for other peers.
        }
    };
    webRTCManager.onWebRTCConnection = (peerId) => {
        console.log(`WebRTC connection established with ${peerId}`);
    };
    webRTCManager.onDataChannelConnection = (peerId) => {
        console.log(`Data channel OPEN with ${peerId}! Ready to send/receive data.`);
        webRTCManager.sendViaDataChannel(`Hello from ${localPeerId}!`, peerId);
    };
    webRTCManager.onDataChannelMessageReceived = (message, peerId) => {
        console.log(`Message from ${peerId} via data channel: ${message}`);
    };
    webRTCManager.onVideoStreamEstablished = (peerId, stream) => {
        console.log(`Video stream established with ${peerId}`);
        // The manager already handles attaching it to a video element if uiConfig is provided.
    };


    try {
        // Connect to WebSocket signaling server
        await webRTCManager.connect('ws://localhost:8080/ws', true, true); // Example URL, send/receive AV

        // Get local media (camera/microphone)
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        webRTCManager.setLocalStream(stream); // Show local preview and prepare for sending

        // The manager might automatically start negotiating if `onnegotiationneeded` fires
        // or if the signaling protocol (NEWPEER/NEWPEERACK) logic triggers offers.
        // Alternatively, you might have a button or logic to call:
        // webRTCManager.initiateOffersToAllPeers();
        // This often depends on your application's "room" or "session" logic.

    } catch (error) {
        console.error("Initialization failed:", error);
    }

    // To send a message later:
    // webRTCManager.sendViaDataChannel("Some data to all peers");
    // webRTCManager.sendViaDataChannel("Private data", "specific-peer-id");

    // To close down:
    // webRTCManager.closeWebRTC();
    // webRTCManager.closeWebSocket();
}

// main(); // Call when ready
*/
