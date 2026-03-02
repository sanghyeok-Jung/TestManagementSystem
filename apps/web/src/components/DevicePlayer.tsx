import React from 'react';
import { Socket } from 'socket.io-client';
import { Loader2, Power } from 'lucide-react';
import { cn } from "@/lib/utils";
import { useDeviceStream } from '../hooks/useDeviceStream';
import { useDeviceInteraction } from '../hooks/useDeviceInteraction';

interface DevicePlayerProps {
    agentId: string;
    deviceId: string;
    socket: Socket;
    readonly?: boolean;
}

export const DevicePlayer: React.FC<DevicePlayerProps> = ({ agentId, deviceId, socket, readonly: _readonly = false }) => {
    const { videoRef, isBuffering, previewImage, fps, videoDimensions } = useDeviceStream({ agentId, deviceId, socket });
    const { handleInteraction, resetInteraction } = useDeviceInteraction({ agentId, deviceId, socket, videoDimensions });

    const handleWake = () => {
        socket.emit('device_input', {
            agentId, deviceId,
            type: 'key',
            keycode: 224
        });
    };

    return (
        <div className="w-full h-full relative select-none bg-black">

            {/* Screenshot preview — shown instantly while waiting for live stream */}
            {previewImage && isBuffering && (
                <img
                    src={previewImage}
                    alt="Device preview"
                    className="absolute inset-0 w-full h-full object-contain z-5 pointer-events-none"
                />
            )}

            {/* Full loading overlay — only when no preview yet */}
            {isBuffering && !previewImage && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/90 pointer-events-none">
                    <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-3" />
                    <div className="text-slate-500 text-[10px] font-bold tracking-[0.2em] uppercase animate-pulse mb-4">
                        Connecting
                    </div>
                    <button
                        onClick={handleWake}
                        className="pointer-events-auto flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800/80 border border-slate-600/50 text-slate-400 text-xs hover:bg-slate-700/80 hover:text-white transition-all cursor-pointer"
                    >
                        <Power size={14} />
                        Wake Screen
                    </button>
                </div>
            )}

            {/* Reconnecting banner — shown on top of preview when stream is resetting */}
            {isBuffering && previewImage && (
                <div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-center gap-2 py-1.5 bg-black/60 backdrop-blur-sm pointer-events-none">
                    <Loader2 className="w-3 h-3 text-blue-400 animate-spin flex-none" />
                    <span className="text-[10px] font-semibold tracking-widest uppercase text-blue-300 animate-pulse">
                        Reconnecting — Touch disabled
                    </span>
                </div>
            )}

            {/* FPS + Dimensions (debug) */}
            {!isBuffering && (
                <div className="absolute top-2 right-2 z-20 px-2 py-1 bg-black/50 text-green-400 text-[10px] font-mono rounded pointer-events-none">
                    FPS: {fps} | {videoDimensions.vw}x{videoDimensions.vh}
                </div>
            )}

            {/* Video: fills container, maintains aspect ratio via object-contain */}
            <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className={cn(
                    "w-full h-full object-contain transition-opacity duration-500",
                    isBuffering
                        ? "opacity-0 pointer-events-none cursor-default"
                        : "opacity-100 cursor-crosshair"
                )}
                onMouseDown={(e) => handleInteraction(e, 'down')}
                onMouseUp={(e) => handleInteraction(e, 'up')}
                onMouseLeave={resetInteraction}
            />
        </div>
    );
};
