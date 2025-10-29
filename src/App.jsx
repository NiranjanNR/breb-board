import { useState, useEffect } from 'react';
import { Copy, Check, Send, Clipboard, Zap, AlertCircle, Trash2, Clock } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

// ⚠️ REPLACE THESE WITH YOUR ACTUAL SUPABASE CREDENTIALS
const SUPABASE_URL = 'https://hbxrkuzhleknrpjhqrtj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhieHJrdXpobGVrbnJwamhxcnRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUwNjU0NDAsImV4cCI6MjA3MDY0MTQ0MH0.4mCYMYGRy5deXqtahQvKtUGYzqyx9BbonHBxsDN2AdU';

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Faster compression using deflate/gzip + Base64
const FastCompressor = {
  async compress(text) {
    const bytes = new TextEncoder().encode(text);
    const stream = new Blob([bytes]).stream();
    const compressedStream = stream.pipeThrough(new CompressionStream('deflate'));
    const buffer = await new Response(compressedStream).arrayBuffer();
    const compressedBytes = new Uint8Array(buffer);
    return btoa(String.fromCharCode(...compressedBytes));
  },
  
  async decompress(compressed) {
    const binaryString = atob(compressed);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const stream = new Blob([bytes]).stream();
    const decompressedStream = stream.pipeThrough(new DecompressionStream('deflate'));
    const buffer = await new Response(decompressedStream).arrayBuffer();
    return new TextDecoder().decode(buffer);
  }
};

// Generate random short ID
const generateShortId = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
};

export default function App() {
  const [inputText, setInputText] = useState('');
  const [shareableLink, setShareableLink] = useState('');
  const [decompressedText, setDecompressedText] = useState('');
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState('create');
  const [loading, setLoading] = useState(false);
  const [compressionRatio, setCompressionRatio] = useState(null);
  const [error, setError] = useState('');
  const [showDecompressed, setShowDecompressed] = useState(false);
  const [supabaseConfigured, setSupabaseConfigured] = useState(true);
  const [expiryTime, setExpiryTime] = useState('24'); // hours
  const [currentClipId, setCurrentClipId] = useState(null);
  const [viewCount, setViewCount] = useState(0);

  // Check if Supabase is configured
  useEffect(() => {
    if (SUPABASE_URL.includes('your-project') || SUPABASE_ANON_KEY.includes('your-anon-key')) {
      setSupabaseConfigured(false);
      setError('⚠️ Supabase not configured! Please add your credentials in the code.');
    }
  }, []);

  useEffect(() => {
    const loadFromPath = async () => {
      const path = window.location.pathname;
      const match = path.match(/\/([a-zA-Z0-9]+)$/);
      
      if (match) {
        const shortId = match[1];
        setLoading(true);
        setError('');
        
        try {
          const { data, error } = await supabase
            .from('clips')
            .select('*')
            .eq('short_id', shortId)
            .single();
          
          if (error) throw error;
          
          if (data) {
            // Check if expired
            const expiresAt = new Date(data.expires_at);
            const now = new Date();
            
            if (expiresAt < now) {
              // Delete expired clip
              await supabase.from('clips').delete().eq('short_id', shortId);
              setError('This clip has expired and been automatically deleted.');
              setMode('create');
              return;
            }
            
            // Increment view count
            const newViewCount = (data.view_count || 0) + 1;
            await supabase
              .from('clips')
              .update({ view_count: newViewCount })
              .eq('short_id', shortId);
            
            setDecompressedText(data.compressed_data);
            setCompressionRatio(data.compression_ratio);
            setViewCount(newViewCount);
            setCurrentClipId(shortId);
            setMode('view');
            
            // Calculate time remaining
            const timeRemaining = Math.floor((expiresAt - now) / 1000 / 60 / 60); // hours
            if (timeRemaining < 24) {
              setError(`⏰ This clip will expire in ${timeRemaining} hours`);
            }
          } else {
            setError('Content not found. This link may have expired or been deleted.');
          }
        } catch (e) {
          console.error('Failed to load:', e);
          setError('Failed to load content. Please check the link and try again.');
        } finally {
          setLoading(false);
        }
      }
    };
    
    if (supabaseConfigured) {
      loadFromPath();
    }
  }, [supabaseConfigured]);

  const handleSend = async () => {
    if (!inputText.trim()) return;
    if (!supabaseConfigured) {
      setError('Please configure Supabase credentials first!');
      return;
    }

    setLoading(true);
    setError('');
    
    try {
      const compressed = await FastCompressor.compress(inputText);
      const shortId = generateShortId();
      
      const ratio = ((compressed.length / inputText.length) * 100).toFixed(2);
      
      // Calculate expiry time
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + parseInt(expiryTime));
      
      // Store in Supabase
      const { data, error } = await supabase
        .from('clips')
        .insert([{
          short_id: shortId,
          compressed_data: compressed,
          original_length: inputText.length,
          compression_ratio: parseFloat(ratio),
          expires_at: expiresAt.toISOString(),
          view_count: 0
        }])
        .select();
      
      if (error) throw error;
      
      const baseUrl = window.location.origin + window.location.pathname.replace(/\/$/, '');
      const link = `${baseUrl}/${shortId}`;
      
      setCompressionRatio(ratio);
      setShareableLink(link);
      setDecompressedText(compressed);
      setCurrentClipId(shortId);
      setMode('view');
      
      window.history.pushState({}, '', `/${shortId}`);
    } catch (e) {
      console.error('Failed to save:', e);
      setError('Failed to create shareable link. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDecompress = async () => {
    setLoading(true);
    setError('');
    
    try {
      const decompressed = await FastCompressor.decompress(decompressedText);
      setDecompressedText(decompressed);
      setShowDecompressed(true);
    } catch (e) {
      console.error('Decompression failed:', e);
      setError('Failed to decompress content.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(decompressedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
      setError('Failed to copy to clipboard.');
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareableLink);
      alert('Link copied to clipboard!');
    } catch (err) {
      console.error('Failed to copy link:', err);
      setError('Failed to copy link.');
    }
  };

  const handleDelete = async () => {
    if (!currentClipId) return;
    
    if (!confirm('Are you sure you want to delete this clip? This action cannot be undone.')) {
      return;
    }
    
    setLoading(true);
    try {
      const { error } = await supabase
        .from('clips')
        .delete()
        .eq('short_id', currentClipId);
      
      if (error) throw error;
      
      alert('Clip deleted successfully!');
      handleReset();
    } catch (e) {
      console.error('Failed to delete:', e);
      setError('Failed to delete clip.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setInputText('');
    setShareableLink('');
    setDecompressedText('');
    setCompressionRatio(null);
    setMode('create');
    setError('');
    setShowDecompressed(false);
    setCurrentClipId(null);
    setViewCount(0);
    window.history.pushState({}, '', '/');
  };

  return (
    <div className="min-h-screen bg-gray-900 p-4">
      <div className="max-w-8xl mx-auto">
        <div className="mb-8 pt-8">
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center ml-5 gap-2">
            <Clipboard className="w-10 h-10 text-indigo-400" />
            breb
          </h1>
          <span className="mt-4 flex items-center gap-2 text-sm ml-5 text-white">
            <Zap className="w-4 h-4" />
            <span className="font-semibold">Deflate compression + Auto-cleanup</span>
          </span>
        </div>

        {error && (
          <div className={`mb-4 p-4 ${error.includes('⏰') ? 'bg-yellow-900/30 border-yellow-500/50 text-yellow-300' : 'bg-red-900/30 border-red-500/50 text-red-300'} border-2  flex items-start gap-2`}>
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {mode === 'create' ? (
          <div className="bg-gray-800  shadow-2xl p-8 border border-gray-700">
            <label className="block text-sm font-medium text-gray-300 mb-3">
              Enter your text or code
            </label>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Paste your code, text, or any content here...&#10;&#10;The more text you add, the better the compression ratio!"
              className="w-full h-64 p-4 bg-gray-900 border-2 border-gray-600  focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none resize-none font-mono text-sm text-gray-100 placeholder-gray-500"
              disabled={loading}
            />
            
            {inputText && (
              <div className="mt-2 text-sm text-gray-400">
                Current size: {inputText.length.toLocaleString()} characters
              </div>
            )}

            {/* Expiry Time Selection */}
            <div className="mt-4 p-4 bg-gray-900  border border-gray-700">
              <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Link expires in:
              </label>
              <div className="grid grid-cols-4 gap-2">
                {['1', '6', '24', '168'].map((hours) => (
                  <button
                    key={hours}
                    onClick={() => setExpiryTime(hours)}
                    className={`py-2 px-3  text-sm font-medium transition-colors ${
                      expiryTime === hours
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    {hours === '1' ? '1 hour' : hours === '6' ? '6 hours' : hours === '24' ? '1 day' : '7 days'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                💡 Clips auto-delete after expiry to save storage
              </p>
            </div>
            
            <button
              onClick={handleSend}
              disabled={!inputText.trim() || loading || !supabaseConfigured}
              className="mt-4 w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold py-3 px-6  transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  Compressing...
                </>
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  Generate Shareable Link
                </>
              )}
            </button>

            {shareableLink && (
              <div className="mt-6 p-4 bg-green-900/30 border-2 border-green-500/50 ">
                <p className="text-sm font-medium text-green-300 mb-2">Shareable Link Generated!</p>
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={shareableLink}
                    readOnly
                    className="flex-1 p-2 bg-gray-900 border border-green-500/50 rounded text-sm text-gray-300"
                  />
                  <button
                    onClick={handleCopyLink}
                    className="bg-green-600 hover:bg-green-700 text-white px-4 rounded transition-colors"
                  >
                    Copy
                  </button>
                </div>
                {compressionRatio && (
                  <div className="text-sm text-green-300 mb-2">
                    <strong>Compression:</strong> {inputText.length.toLocaleString()} chars → {compressionRatio}% of original
                  </div>
                )}
                <p className="text-xs text-green-400">
                  ⏰ Expires in {expiryTime === '1' ? '1 hour' : expiryTime === '6' ? '6 hours' : expiryTime === '24' ? '1 day' : '7 days'}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-gray-800  shadow-2xl p-8 border border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold text-white">Shared Content</h2>
                {viewCount > 0 && (
                  <p className="text-sm text-gray-400 mt-1">👁️ Viewed {viewCount} time{viewCount !== 1 ? 's' : ''}</p>
                )}
              </div>
              <div className="flex gap-2">
                {currentClipId && showDecompressed && (
                  <button
                    onClick={handleDelete}
                    className="text-red-400 hover:text-red-300 font-medium text-sm flex items-center gap-1"
                    title="Delete this clip"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                )}
                <button
                  onClick={handleReset}
                  className="text-indigo-400 hover:text-indigo-300 font-medium text-sm"
                >
                  Create New
                </button>
              </div>
            </div>
            
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-400 mx-auto mb-4"></div>
                  <p className="text-gray-400">Loading...</p>
                </div>
              </div>
            ) : !showDecompressed ? (
              <div className="text-center py-12">
                <div className="bg-gray-900  p-8 border-2 border-gray-600">
                  <Clipboard className="w-16 h-16 text-indigo-400 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-white mb-2">Compressed Content Ready</h3>
                  <p className="text-gray-400 mb-6">
                    Click the button below to decompress and view the shared content
                  </p>
                  <button
                    onClick={handleDecompress}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-8  transition-colors inline-flex items-center gap-2"
                  >
                    <Zap className="w-5 h-5" />
                    Decompress & View
                  </button>
                  {compressionRatio && (
                    <p className="text-sm text-gray-500 mt-4">
                      Compressed to {compressionRatio}% of original size
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="relative">
                <pre className="w-full h-64 p-4 bg-gray-900 border-2 border-gray-600  overflow-auto font-mono text-sm whitespace-pre-wrap break-words text-gray-100">
                  {decompressedText}
                </pre>
                
                <button
                  onClick={handleCopy}
                  className="mt-4 w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-6  transition-colors flex items-center justify-center gap-2"
                >
                  {copied ? (
                    <>
                      <Check className="w-5 h-5" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-5 h-5" />
                      Copy to Clipboard
                    </>
                  )}
                </button>
              </div>
            )}

            {compressionRatio && !loading && showDecompressed && (
              <div className="mt-6 p-4 bg-blue-900/30 border-2 border-blue-500/50 ">
                <p className="text-sm text-blue-300">
                  <strong>Compression achieved:</strong> Content compressed to {compressionRatio}% of original size
                </p>
                <p className="text-xs text-blue-400 mt-1">
                  Algorithm: Deflate (gzip) + Base64 encoding
                </p>
              </div>
            )}
          </div>
        )}

        <div className="mt-8 text-center text-sm text-gray-500 space-y-1">
          <p>⚡ Fast compression with browser-native Deflate</p>
          <p>🗑️ Auto-delete expired clips to save storage</p>
          <p>📊 View count tracking for analytics</p>
          <p>🔒 All compression happens client-side</p>
        </div>
      </div>
    </div>
  );
}