/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useCallback } from 'react';
import { Upload, Music, Play, Download, Trash2, CheckCircle2, AlertCircle, Loader2, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import pako from 'pako';
import confetti from 'canvas-confetti';

// Geometry Dash Constants
const UNITS_PER_SECOND = 311.58; // 1x speed
const GROUND_Y = 15;
const BLOCK_SIZE = 30;

interface Peak {
  time: number;
  intensity: number;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [levelData, setLevelData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [levelName, setLevelName] = useState('Synced Level');
  const [progress, setProgress] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type.startsWith('audio/')) {
      setFile(selectedFile);
      setError(null);
      // Auto-set level name from filename
      const name = selectedFile.name.replace(/\.[^/.]+$/, "");
      setLevelName(name.substring(0, 20));
    } else {
      setError('Please upload a valid MP3 or audio file.');
    }
  };

  const analyzeAudio = async (audioFile: File): Promise<Peak[]> => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const arrayBuffer = await audioFile.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const channelData = audioBuffer.getChannelData(0); // Use first channel
    const sampleRate = audioBuffer.sampleRate;
    
    // Simple peak detection
    const peaks: Peak[] = [];
    const threshold = 0.4; // Sensitivity
    const minDistance = 0.3; // Min seconds between peaks
    let lastPeakTime = -minDistance;

    // Process in chunks for performance
    const chunkSize = Math.floor(sampleRate * 0.05); // 50ms chunks
    for (let i = 0; i < channelData.length; i += chunkSize) {
      const chunk = channelData.slice(i, i + chunkSize);
      let maxVal = 0;
      for (let j = 0; j < chunk.length; j++) {
        const absVal = Math.abs(chunk[j]);
        if (absVal > maxVal) maxVal = absVal;
      }

      const currentTime = i / sampleRate;
      if (maxVal > threshold && currentTime - lastPeakTime > minDistance) {
        peaks.push({ time: currentTime, intensity: maxVal });
        lastPeakTime = currentTime;
      }
      
      // Update progress
      if (i % (chunkSize * 20) === 0) {
        setProgress(Math.round((i / channelData.length) * 100));
      }
    }

    return peaks;
  };

  const generateGDLevelString = (peaks: Peak[]): string => {
    // Level Header (Standard settings for a basic level)
    // kS38 is the level string key in save files, but for .gmd we need the raw object string
    // Format: settings;obj1;obj2;...
    
    // Basic settings string (colors, speed, etc.)
    // kS38:1 (version), kS39:1 (revision), kS1:255,kS2:255,kS3:255 (BG Color White)
    const settings = "kS38,1,kS39,1,kS1,0,kS2,0,kS3,0,kS5,0,kS8,1,kS10,1,kS11,1,kS12,1,kS13,1,kS14,1,kS15,1,kS16,1,kS17,1,kS18,1,kS19,1,kS20,1,kS21,1,kS22,1,kS23,1,kS24,1,kS25,1,kS26,1,kS27,1,kS28,1,kS29,1,kS30,1,kS31,1,kS32,1,kS33,1,kS34,1,kS35,1,kS36,1,kS37,1";
    
    const objects: string[] = [];

    // Add a starting platform
    for (let i = 0; i < 10; i++) {
      objects.push(`1,1,2,${i * 30},3,${GROUND_Y}`);
    }

    peaks.forEach((peak, index) => {
      const x = Math.round(peak.time * UNITS_PER_SECOND);
      
      // Every peak, place a spike or a jump
      if (index % 3 === 0) {
        // Triple spike occasionally
        objects.push(`1,8,2,${x},3,${GROUND_Y + 30}`);
        objects.push(`1,8,2,${x + 30},3,${GROUND_Y + 30}`);
        objects.push(`1,8,2,${x + 60},3,${GROUND_Y + 30}`);
      } else if (index % 2 === 0) {
        // Single spike
        objects.push(`1,8,2,${x},3,${GROUND_Y + 30}`);
      } else {
        // Block jump
        objects.push(`1,1,2,${x},3,${GROUND_Y + 30}`);
        objects.push(`1,8,2,${x},3,${GROUND_Y + 60}`); // Spike on top of block
      }

      // Add floor blocks to prevent falling
      for (let f = -2; f <= 2; f++) {
        objects.push(`1,1,2,${x + f * 30},3,${GROUND_Y}`);
      }
    });

    // Add an end trigger or just some blocks
    const lastX = peaks.length > 0 ? Math.round(peaks[peaks.length - 1].time * UNITS_PER_SECOND) + 300 : 1000;
    objects.push(`1,1,2,${lastX},3,${GROUND_Y}`);

    return `${settings};${objects.join(';')}`;
  };

  const encodeLevelData = (rawString: string): string => {
    // GD uses a specific encoding: Gzip -> Base64 -> URL Safe
    const compressed = pako.gzip(rawString);
    
    // Robust Uint8Array to Base64 conversion
    let binary = '';
    const len = compressed.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(compressed[i]);
    }
    const base64 = btoa(binary);
    
    return base64.replace(/\+/g, '-').replace(/\//g, '_');
  };

  const generateGMDFile = (encodedData: string) => {
    const xml = `<?xml version="1.0"?>
<plist version="1.0" sodat="0.0">
	<dict>
		<key>kCEK</key>
		<integer>4</integer>
		<key>kGK</key>
		<integer>1</integer>
		<key>kS1</key>
		<string>${levelName}</string>
		<key>kS2</key>
		<string>Generated by GD Sync AI</string>
		<key>kS3</key>
		<string>${encodedData}</string>
		<key>kS4</key>
		<string>AI Studio</string>
		<key>kS5</key>
		<integer>0</integer>
		<key>kS6</key>
		<integer>0</integer>
		<key>kS7</key>
		<string>0</string>
		<key>kS8</key>
		<integer>10</integer>
		<key>kS9</key>
		<integer>0</integer>
		<key>kS10</key>
		<integer>0</integer>
		<key>kS11</key>
		<integer>0</integer>
		<key>kS12</key>
		<integer>0</integer>
		<key>kS13</key>
		<integer>0</integer>
		<key>kS14</key>
		<integer>0</integer>
		<key>kS15</key>
		<integer>0</integer>
		<key>kS16</key>
		<integer>0</integer>
		<key>kS17</key>
		<integer>0</integer>
		<key>kS18</key>
		<integer>0</integer>
		<key>kS19</key>
		<integer>0</integer>
		<key>kS20</key>
		<integer>0</integer>
	</dict>
</plist>`;
    return xml;
  };

  const handleGenerate = async () => {
    if (!file) return;

    setIsAnalyzing(true);
    setProgress(0);
    setError(null);

    try {
      const peaks = await analyzeAudio(file);
      if (peaks.length === 0) {
        throw new Error("Could not detect any clear beats in this audio. Try a more rhythmic track.");
      }
      
      const rawLevel = generateGDLevelString(peaks);
      const encoded = encodeLevelData(rawLevel);
      const gmdContent = generateGMDFile(encoded);
      
      setLevelData(gmdContent);
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#22c55e', '#3b82f6', '#f59e0b']
      });
    } catch (err: any) {
      setError(err.message || "An error occurred during generation.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const downloadFile = () => {
    if (!levelData) return;
    const blob = new Blob([levelData], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${levelName.replace(/\s+/g, '_')}.gmd`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setFile(null);
    setLevelData(null);
    setError(null);
    setProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white font-sans selection:bg-blue-500/30">
      {/* Background Decorative Elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-600/10 blur-[120px] rounded-full" />
      </div>

      <main className="relative max-w-4xl mx-auto px-6 py-12 md:py-24">
        {/* Header */}
        <header className="text-center mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm font-medium mb-6">
              <Sparkles className="w-4 h-4" />
              <span>AI-Powered Level Generation</span>
            </div>
            <h1 className="text-5xl md:text-7xl font-black tracking-tighter mb-6 bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent">
              GD SYNC <span className="text-blue-500">GEN</span>
            </h1>
            <p className="text-lg text-gray-400 max-w-xl mx-auto">
              Transform your favorite music into a playable Geometry Dash level. 
              Our AI analyzes the rhythm and maps it to obstacles.
            </p>
          </motion.div>
        </header>

        {/* Main Interface */}
        <div className="grid gap-8">
          <AnimatePresence mode="wait">
            {!levelData ? (
              <motion.div
                key="upload-step"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-[#121214] border border-white/5 rounded-3xl p-8 md:p-12 shadow-2xl"
              >
                {!file ? (
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="group relative border-2 border-dashed border-white/10 rounded-2xl p-12 text-center cursor-pointer hover:border-blue-500/50 hover:bg-blue-500/5 transition-all duration-300"
                  >
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept="audio/*"
                      className="hidden"
                    />
                    <div className="w-20 h-20 bg-white/5 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform duration-300">
                      <Upload className="w-10 h-10 text-gray-400 group-hover:text-blue-500" />
                    </div>
                    <h3 className="text-xl font-bold mb-2">Upload your MP3</h3>
                    <p className="text-gray-500">Drag and drop or click to browse</p>
                  </div>
                ) : (
                  <div className="space-y-8">
                    <div className="flex items-center gap-6 p-6 bg-white/5 rounded-2xl border border-white/5">
                      <div className="w-16 h-16 bg-blue-500/20 rounded-xl flex items-center justify-center">
                        <Music className="w-8 h-8 text-blue-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-bold truncate">{file.name}</h3>
                        <p className="text-sm text-gray-500">{(file.size / (1024 * 1024)).toFixed(2)} MB • Ready to sync</p>
                      </div>
                      <button 
                        onClick={reset}
                        className="p-3 text-gray-500 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-colors"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="space-y-4">
                      <label className="text-sm font-medium text-gray-400 uppercase tracking-wider">Level Name</label>
                      <input 
                        type="text" 
                        value={levelName}
                        onChange={(e) => setLevelName(e.target.value)}
                        placeholder="Enter level name..."
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-6 py-4 text-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                      />
                    </div>

                    <button
                      onClick={handleGenerate}
                      disabled={isAnalyzing}
                      className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-500 py-5 rounded-2xl font-bold text-xl flex items-center justify-center gap-3 transition-all active:scale-[0.98]"
                    >
                      {isAnalyzing ? (
                        <>
                          <Loader2 className="w-6 h-6 animate-spin" />
                          <span>Analyzing Rhythm {progress}%</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-6 h-6 fill-current" />
                          <span>Generate .GMD Level</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {error && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400"
                  >
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <p className="text-sm">{error}</p>
                  </motion.div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="success-step"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-[#121214] border border-emerald-500/20 rounded-3xl p-8 md:p-12 shadow-2xl text-center"
              >
                <div className="w-24 h-24 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-8">
                  <CheckCircle2 className="w-12 h-12 text-emerald-500" />
                </div>
                <h2 className="text-3xl font-black mb-4">Level Generated!</h2>
                <p className="text-gray-400 mb-12 max-w-md mx-auto">
                  Your level "{levelName}" is ready. You can now download the .gmd file and import it using GDShare or other tools.
                </p>

                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <button
                    onClick={downloadFile}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 py-5 rounded-2xl font-bold text-xl flex items-center justify-center gap-3 transition-all active:scale-[0.98]"
                  >
                    <Download className="w-6 h-6" />
                    <span>Download .GMD</span>
                  </button>
                  <button
                    onClick={reset}
                    className="px-8 bg-white/5 hover:bg-white/10 py-5 rounded-2xl font-bold text-xl transition-all"
                  >
                    Start Over
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer Info */}
        <footer className="mt-24 text-center text-gray-500 text-sm space-y-4">
          <p>How to use: Download the .gmd file, then use a tool like <b>GDShare</b> or <b>Level Import</b> to add it to your Geometry Dash account.</p>
          <div className="flex justify-center gap-6">
            <span className="flex items-center gap-1"><CheckCircle2 className="w-4 h-4 text-blue-500" /> Beat Detection</span>
            <span className="flex items-center gap-1"><CheckCircle2 className="w-4 h-4 text-blue-500" /> Auto-Mapping</span>
            <span className="flex items-center gap-1"><CheckCircle2 className="w-4 h-4 text-blue-500" /> Gzip Encoding</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
