import { useRef, useCallback } from 'react';
import { Socket } from 'socket.io-client';

interface UseDeviceInteractionProps {
    agentId: string;
    deviceId: string;
    socket: Socket;
    videoDimensions: { vw: number; vh: number };
}

export const useDeviceInteraction = ({ agentId, deviceId, socket, videoDimensions }: UseDeviceInteractionProps) => {
    const interactionState = useRef({
        isDown: false,
        startX: 0,
        startY: 0,
        startTime: 0
    });

    /**
     * Calculate the actual rendered content area within an object-contain video.
     * Uses videoDimensions from state (updated via loadedmetadata) so rotation
     * changes are reflected immediately without relying on event-time DOM reads.
     */
    const getContentCoords = useCallback((e: React.MouseEvent<HTMLElement>) => {
        const el = e.currentTarget;
        // Use state-driven dimensions (updated on loadedmetadata) as primary source,
        // fall back to DOM property for initial portrait load before first reset.
        // For <img> elements (iOS), use naturalWidth/naturalHeight.
        let vw = videoDimensions.vw || 0;
        let vh = videoDimensions.vh || 0;

        if (!vw || !vh) {
            if (el instanceof HTMLVideoElement) {
                vw = el.videoWidth || 0;
                vh = el.videoHeight || 0;
            } else if (el instanceof HTMLImageElement) {
                vw = el.naturalWidth || 0;
                vh = el.naturalHeight || 0;
            }
        }

        const cw = el.clientWidth;
        const ch = el.clientHeight;

        if (!cw || !ch) return null;

        // When no content dimensions available (screen off), use simple relative coords
        if (!vw || !vh) {
            return {
                x: Math.max(0, Math.min(1, e.nativeEvent.offsetX / cw)),
                y: Math.max(0, Math.min(1, e.nativeEvent.offsetY / ch)),
                isLandscape: false
            };
        }

        const videoRatio = vw / vh;
        const elementRatio = cw / ch;

        let renderW: number, renderH: number, offsetLeft: number, offsetTop: number;

        if (videoRatio > elementRatio) {
            // Video wider than container: letterbox top/bottom
            renderW = cw;
            renderH = cw / videoRatio;
            offsetLeft = 0;
            offsetTop = (ch - renderH) / 2;
        } else {
            // Video taller than container: pillarbox left/right
            renderH = ch;
            renderW = ch * videoRatio;
            offsetTop = 0;
            offsetLeft = (cw - renderW) / 2;
        }

        const relX = (e.nativeEvent.offsetX - offsetLeft) / renderW;
        const relY = (e.nativeEvent.offsetY - offsetTop) / renderH;

        return {
            x: Math.max(0, Math.min(1, relX)),
            y: Math.max(0, Math.min(1, relY)),
            isLandscape: vw > vh
        };
    }, [videoDimensions]);

    const handleInteraction = useCallback((
        e: React.MouseEvent<HTMLElement>,
        type: 'down' | 'up'
    ) => {

        const coords = getContentCoords(e);
        if (!coords) return;

        if (type === 'down') {
            interactionState.current = {
                isDown: true,
                startX: coords.x,
                startY: coords.y,
                startTime: Date.now()
            };
        } else if (type === 'up' && interactionState.current.isDown) {
            const duration = Date.now() - interactionState.current.startTime;
            const dist = Math.sqrt(
                Math.pow(coords.x - interactionState.current.startX, 2) +
                Math.pow(coords.y - interactionState.current.startY, 2)
            );

            if (dist < 0.05 && duration < 500) {
                console.log(`[Input] TAP (${coords.x.toFixed(3)}, ${coords.y.toFixed(3)}) isLandscape=${coords.isLandscape}`);
                socket.emit('device_input', {
                    agentId, deviceId,
                    type: 'tap',
                    x: coords.x, y: coords.y,
                    isLandscape: coords.isLandscape
                });
            } else {
                console.log(`[Input] SWIPE (${interactionState.current.startX.toFixed(3)},${interactionState.current.startY.toFixed(3)}) → (${coords.x.toFixed(3)},${coords.y.toFixed(3)})`);
                socket.emit('device_input', {
                    agentId, deviceId,
                    type: 'swipe',
                    x1: interactionState.current.startX,
                    y1: interactionState.current.startY,
                    x2: coords.x, y2: coords.y,
                    isLandscape: coords.isLandscape
                });
            }
            interactionState.current.isDown = false;
        }
    }, [agentId, deviceId, socket, getContentCoords]);

    const resetInteraction = useCallback(() => {
        interactionState.current.isDown = false;
    }, []);

    return { handleInteraction, resetInteraction };
};
