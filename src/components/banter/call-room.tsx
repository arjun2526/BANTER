import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, SwitchCamera, Video, VideoOff } from "lucide-react";
import * as api from "@/lib/banter/api";

export function CallRoom({
  callId,
  kind,
  role,
  peerName,
  onHangup,
}: {
  callId: string;
  kind: "voice" | "video";
  role: "caller" | "callee";
  peerName: string;
  onHangup: () => void;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState(role === "caller" ? "Ringing" : "Connecting");
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(kind === "video");
  const [facing, setFacing] = useState<"user" | "environment">("user");

  useEffect(() => {
    let stopped = false;
    let after = 0;
    let offered = false;
    const remote = new MediaStream();
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    pcRef.current = pc;
    pc.onconnectionstatechange = () => {
      if (stopped) return;
      if (pc.connectionState === "connected") setPhase("Connected");
      else if (pc.connectionState === "failed") {
        setPhase("This network blocked a direct call. Banter has no relay server, so some connections cannot complete.");
      } else if (pc.connectionState === "disconnected") setPhase("Reconnecting");
      else setPhase(pc.connectionState);
    };
    pc.ontrack = (ev) => {
      for (const track of ev.streams[0]?.getTracks() ?? [ev.track]) {
        if (!remote.getTracks().includes(track)) remote.addTrack(track);
      }
      if (remoteRef.current) remoteRef.current.srcObject = remote;
    };
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      void api.postSignal({
        data: { callId, payload: JSON.stringify({ type: "ice", candidate: ev.candidate.toJSON() }) },
      });
    };

    async function ensureMedia() {
      if (localStream.current) return localStream.current;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: kind === "video" ? { facingMode } : false,
      });
      localStream.current = stream;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      if (localRef.current) localRef.current.srcObject = stream;
      return stream;
    }

    const facingMode: "user" | "environment" = "user";

    async function maybeOffer(status: string) {
      if (role !== "caller" || offered || status !== "active") return;
      offered = true;
      setPhase("Connecting");
      await ensureMedia();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await api.postSignal({ data: { callId, payload: JSON.stringify({ type: "offer", sdp: pc.localDescription }) } });
    }

    async function tick() {
      if (stopped) return;
      const res = await api.pollCall({ data: { callId, after } });
      if (!res.ok || stopped) return;
      if (res.status === "declined" || res.status === "missed" || res.status === "ended") {
        setPhase(res.status === "declined" ? "Declined" : res.status === "missed" ? "No answer" : "Ended");
        window.setTimeout(onHangup, 600);
        return;
      }
      if (res.status === "ringing" && role === "caller") setPhase("Ringing");
      if (res.status === "active" && role === "callee" && !localStream.current) {
        try {
          await ensureMedia();
        } catch {
          setPhase("Camera or microphone permission was denied.");
          return;
        }
      }
      try {
        await maybeOffer(res.status);
      } catch {
        setPhase("Camera or microphone permission was denied.");
        return;
      }
      for (const sig of res.signals) {
        after = Math.max(after, sig.id);
        let msg: { type?: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
        try {
          msg = JSON.parse(sig.payload) as typeof msg;
        } catch {
          continue;
        }
        if (msg.type === "offer" && msg.sdp && role === "callee") {
          await ensureMedia();
          await pc.setRemoteDescription(msg.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await api.postSignal({ data: { callId, payload: JSON.stringify({ type: "answer", sdp: pc.localDescription }) } });
        } else if (msg.type === "answer" && msg.sdp && role === "caller") {
          if (!pc.currentRemoteDescription) await pc.setRemoteDescription(msg.sdp);
        } else if (msg.type === "ice" && msg.candidate) {
          try {
            await pc.addIceCandidate(msg.candidate);
          } catch {
            /* candidate can arrive early */
          }
        }
      }
    }

    const timer = window.setInterval(() => void tick(), 1000);
    void tick();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      localStream.current?.getTracks().forEach((track) => track.stop());
      localStream.current = null;
      pc.close();
      pcRef.current = null;
    };
    // facing is applied by the flip control, not this setup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId, kind, role]);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    localStream.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
  }

  function toggleCam() {
    const next = !cameraOn;
    setCameraOn(next);
    localStream.current?.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
  }

  async function flip() {
    const next = facing === "user" ? "environment" : "user";
    setFacing(next);
    const stream = localStream.current;
    const pc = pcRef.current;
    if (!stream || !pc) return;
    const video = stream.getVideoTracks()[0];
    const fresh = await navigator.mediaDevices.getUserMedia({ video: { facingMode: next }, audio: false });
    const track = fresh.getVideoTracks()[0];
    if (!track) return;
    const sender = pc.getSenders().find((s) => s.track?.kind === "video");
    await sender?.replaceTrack(track);
    if (video) {
      video.stop();
      stream.removeTrack(video);
    }
    stream.addTrack(track);
    if (localRef.current) localRef.current.srcObject = stream;
  }

  return (
    <div className="relative flex h-full flex-col bg-sunken text-fg">
      <video ref={remoteRef} autoPlay playsInline className="absolute inset-0 size-full object-cover" />
      <div className="relative z-10 flex flex-1 flex-col justify-between p-5">
        <div>
          <p className="text-xs tracking-wide text-apricot uppercase">
            {kind === "video" ? "Video" : "Voice"}
          </p>
          <h1 className="font-display text-4xl">{peerName}</h1>
          <p className="mt-1 text-sm text-muted">{phase}</p>
        </div>
        <video ref={localRef} autoPlay muted playsInline className="ml-auto size-28 rounded-3xl object-cover ring-1 ring-line" />
        <div className="flex items-center justify-center gap-3 pb-4">
          <button type="button" className="grid size-14 place-items-center rounded-full bg-elev" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
            {muted ? <MicOff /> : <Mic />}
          </button>
          {kind === "video" ? (
            <>
              <button type="button" className="grid size-14 place-items-center rounded-full bg-elev" onClick={toggleCam} aria-label="Toggle camera">
                {cameraOn ? <Video /> : <VideoOff />}
              </button>
              <button type="button" className="grid size-14 place-items-center rounded-full bg-elev" onClick={() => void flip()} aria-label="Flip camera">
                <SwitchCamera />
              </button>
            </>
          ) : null}
          <button type="button" className="grid size-14 place-items-center rounded-full bg-danger text-on-clay" onClick={onHangup} aria-label="Hang up">
            <PhoneOff />
          </button>
        </div>
      </div>
    </div>
  );
}
