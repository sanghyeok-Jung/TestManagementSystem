import { useEffect, useRef, useState } from 'react';
import JMuxer from 'jmuxer';
import { Socket } from 'socket.io-client';

interface UseDeviceStreamProps {
    agentId: string;
    deviceId: string;
    socket: Socket;
    platform: 'android' | 'ios';
}

export const useDeviceStream = ({ agentId, deviceId, socket, platform }: UseDeviceStreamProps) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isBuffering, setIsBuffering] = useState(true);
    const [fps, setFps] = useState(0);
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    // Track actual decoded video dimensions — updated on every loadedmetadata event
    const [videoDimensions, setVideoDimensions] = useState<{ vw: number; vh: number }>({ vw: 0, vh: 0 });
    const jmuxerRef = useRef<any>(null);
    const frameCountRef = useRef(0);
    const hasReceivedFrame = useRef(false);

    useEffect(() => {
        if (!videoRef.current) return;

        let currentJmuxer: any = null;

        const initJmuxer = () => {
            if (currentJmuxer) {
                currentJmuxer.destroy();
            }
            if (jmuxerRef.current && jmuxerRef.current !== currentJmuxer) {
                jmuxerRef.current.destroy();
            }
            currentJmuxer = new JMuxer({
                node: videoRef.current,
                mode: 'video',
                flushingTime: 0,
                fps: 30,
                debug: false,
                clearBuffer: false  // Keep buffer — avoids frequent stalls that delay the 'playing' event
            });
            jmuxerRef.current = currentJmuxer;
        };

        initJmuxer();

        // Join the stream room
        socket.emit('join_stream', { agentId, deviceId });

        // FPS Counter
        const watchdogInterval = setInterval(() => {
            setFps(frameCountRef.current);
            frameCountRef.current = 0;
        }, 1000);

        const handleStreamData = (data: { deviceId: string, chunk: ArrayBuffer }) => {
            if (data.deviceId === deviceId) {
                const buffer = new Uint8Array(data.chunk);
                try {
                    currentJmuxer.feed({ video: buffer });
                    frameCountRef.current++;
                } catch (e) {
                    console.error('[Stream] JMuxer feed error:', e);
                }

                if (!hasReceivedFrame.current) {
                    hasReceivedFrame.current = true;
                    videoRef.current?.play().catch((e) => console.error('[Stream] Play error:', e));
                }
            }
        };

        const handleStreamPreview = (data: { deviceId: string, image: string }) => {
            if (data.deviceId === deviceId) {
                setPreviewImage(data.image);
                // For iOS (screenshot-based streaming) the preview IS the stream.
                // After the first preview frame arrives, mark as "not buffering"
                // so that the UI shows the image and enables interaction.
                // For Android, we keep buffering until the H.264 video actually fires 'playing'.
                if (platform === 'ios') {
                    if (!hasReceivedFrame.current) {
                        hasReceivedFrame.current = true;
                    }
                    setIsBuffering(false);
                }
            }
        };

        const handleStreamReset = (data: { deviceId: string }) => {
            if (data.deviceId === deviceId) {
                console.log('[Stream] stream_reset received — reinitialising decoder');
                hasReceivedFrame.current = false;
                setIsBuffering(true);
                setVideoDimensions({ vw: 0, vh: 0 });
                initJmuxer();
            }
        };

        socket.on('stream_data', handleStreamData);
        socket.on('stream_preview', handleStreamPreview);
        socket.on('stream_reset', handleStreamReset);

        if (videoRef.current) {
            videoRef.current.addEventListener('error', (e) => console.error('[Video] Error:', e));

            // Update videoDimensions whenever the stream's metadata changes (rotation switch)
            videoRef.current.addEventListener('loadedmetadata', () => {
                if (videoRef.current) {
                    const vw = videoRef.current.videoWidth;
                    const vh = videoRef.current.videoHeight;
                    console.log(`[Stream] loadedmetadata: ${vw}x${vh}`);
                    setVideoDimensions({ vw, vh });
                }
            });

            // 'playing' fires the moment the browser starts rendering frames —
            // much earlier than timeupdate(currentTime>0) which waits up to 500ms.
            videoRef.current.addEventListener('playing', () => {
                setIsBuffering(false);
                setPreviewImage(null);
            });
        }

        return () => {
            socket.emit('leave_stream', { agentId, deviceId });
            socket.off('stream_data', handleStreamData);
            socket.off('stream_preview', handleStreamPreview);
            socket.off('stream_reset', handleStreamReset);
            clearInterval(watchdogInterval);
            if (currentJmuxer) {
                currentJmuxer.destroy();
            }
            if (jmuxerRef.current && jmuxerRef.current !== currentJmuxer) {
                jmuxerRef.current.destroy();
            }
            jmuxerRef.current = null;
            hasReceivedFrame.current = false;
        };
    }, [agentId, deviceId, socket]);

    return {
        videoRef,
        isBuffering,
        fps,
        previewImage,
        videoDimensions,
    };
};
