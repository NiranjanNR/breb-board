import { useState, useEffect } from 'react';
import { Copy, Check, Send, Clipboard, Zap, AlertCircle, Trash2, RefreshCw } from 'lucide-react';
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
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [compressionRatio, setCompressionRatio] = useState(null);
  const [error, setError] = useState('');
  const [supabaseConfigured, setSupabaseConfigured] = useState(true);
  const [customUrl, setCustomUrl] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

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
      const match = path.match(/\/([a-zA-Z0-9_-]+)$/);
      
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
              return;
            }
            
            // Increment view count
            const newViewCount = (data.view_count || 0) + 1;
            await supabase
              .from('clips')
              .update({ view_count: newViewCount })
              .eq('short_id', shortId);
            
            // Auto-decompress
            const decompressed = await FastCompressor.decompress(data.compressed_data);
            setInputText(decompressed);
            setCompressionRatio(data.compression_ratio);
            setCustomUrl(shortId);
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
    setSuccessMessage('');
    
    try {
      const compressed = await FastCompressor.compress(inputText);
      
      // Use custom URL if provided, otherwise generate new one
      let shortId;
      let isUpdate = false;
      
      if (customUrl.trim()) {
        // Sanitize custom URL (remove special characters)
        shortId = customUrl.trim().replace(/[^a-zA-Z0-9_-]/g, '');
        if (shortId.length < 3) {
          setError('Custom URL must be at least 3 characters long');
          setLoading(false);
          return;
        }
        
        // Check if this URL already exists
        const { data: existing, error: fetchError } = await supabase
          .from('clips')
          .select('*')
          .eq('short_id', shortId)
          .maybeSingle();
        
        isUpdate = !!existing;
        setIsUpdating(isUpdate);
      } else {
        shortId = generateShortId();
      }
      
      const ratio = ((compressed.length / inputText.length) * 100).toFixed(2);
      
      // Calculate expiry time (2 hours)
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 2);
      
      const clipData = {
        compressed_data: compressed,
        original_length: inputText.length,
        compression_ratio: parseFloat(ratio),
        expires_at: expiresAt.toISOString()
      };
      
      if (isUpdate) {
        // Update existing clip
        const { error } = await supabase
          .from('clips')
          .update({
            ...clipData,
            created_at: new Date().toISOString()
          })
          .eq('short_id', shortId);
        
        if (error) throw error;
        setSuccessMessage('✅ Content updated successfully!');
      } else {
        // Create new clip using upsert to handle race conditions
        const { error } = await supabase
          .from('clips')
          .upsert([{
            short_id: shortId,
            ...clipData,
            view_count: 0
          }], {
            onConflict: 'short_id',
            ignoreDuplicates: false
          });
        
        if (error) throw error;
        setSuccessMessage('✅ Shareable link created!');
      }
      
      setCompressionRatio(ratio);
      setCustomUrl(shortId); // Save the URL for reuse
      
      // Update URL without page reload
      const baseUrl = window.location.origin + window.location.pathname.replace(/\/$/, '');
      window.history.pushState({}, '', `/${shortId}`);
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (e) {
      console.error('Failed to save:', e);
      setError('Failed to create/update shareable link. Please try again.');
    } finally {
      setLoading(false);
      setIsUpdating(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inputText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
      setError('Failed to copy to clipboard.');
    }
  };

  const handleDelete = async () => {
    if (!customUrl) return;
    
    if (!confirm('Are you sure you want to delete this clip? This action cannot be undone.')) {
      return;
    }
    
    setLoading(true);
    try {
      const { error } = await supabase
        .from('clips')
        .delete()
        .eq('short_id', customUrl);
      
      if (error) throw error;
      
      setInputText('');
      setCustomUrl('');
      setCompressionRatio(null);
      setSuccessMessage('✅ Clip deleted successfully!');
      window.history.pushState({}, '', '/');
      
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (e) {
      console.error('Failed to delete:', e);
      setError('Failed to delete clip.');
    } finally {
      setLoading(false);
    }
  };

  const getCurrentUrl = () => {
    if (customUrl) {
      const baseUrl = window.location.origin + window.location.pathname.replace(/\/$/, '');
      return `${baseUrl}/${customUrl}`;
    }
    return '';
  };

  const handleCopyUrl = async () => {
    const url = getCurrentUrl();
    if (!url) return;
    
    try {
      await navigator.clipboard.writeText(url);
      setSuccessMessage('🔗 URL copied to clipboard!');
      setTimeout(() => setSuccessMessage(''), 2000);
    } catch (err) {
      console.error('Failed to copy URL:', err);
      setError('Failed to copy URL.');
    }
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-gray-900 p-4">
      <div className="max-w-8xl mx-auto">
        <div className="mb-4 pt-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center ml-5 gap-2">
              <Clipboard className="w-10 h-10 text-indigo-400" />
              <h1 className="text-4xl font-bold text-white">breb</h1>
            </div>
            
          </div>
          <span className="mt-2 flex items-center justify-between gap-2 text-sm mx-5 text-white">
            <div className='flex items-center gap-2 '> <Zap className="w-4 h-4" />
            <span className="font-semibold">Deflate compression + Auto-cleanup (2 hour expiry)</span></div>
            <button
              onClick={handleRefresh}
              className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white  px-2 py-2 rounded transition-colors flex items-center gap-2 border border-gray-700"
              title="Refresh page"
            >
              <RefreshCw className="w-4 h-4" />
              
            </button>
          </span>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-900/30 border-red-500/50 text-red-300 border-2 flex items-start gap-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="mb-4 p-4 bg-green-900/30 border-green-500/50 text-green-300 border-2 flex items-start gap-2">
            <Check className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span>{successMessage}</span>
          </div>
        )}

        <div className="bg-gray-800 shadow-2xl p-5 border border-gray-700">
          {/* Custom URL Input with Actions */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Custom URL (optional - reuse the same link)
            </label>
            <div className="flex gap-3 items-start">
              {/* URL Input Box */}
              <div className="flex-1 relative">
                <div className="flex items-center bg-gray-900 border border-gray-600 rounded focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20">
                  <span className="text-gray-400 text-sm pl-3">{window.location.origin}/</span>
                  <input
                    type="text"
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    placeholder="my-custom-url"
                    className="flex-1 p-2 bg-transparent text-sm text-gray-100 placeholder-gray-500 outline-none"
                  />
                  {customUrl && (
                    <>
                      <button
                        onClick={handleCopyUrl}
                        className="px-3 py-2 text-indigo-400 hover:text-indigo-300 transition-colors"
                        title="Copy full URL"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setCustomUrl('')}
                        className="px-3 py-2 text-gray-400 hover:text-gray-300 transition-colors border-l border-gray-700"
                        title="Clear URL"
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  💡 Leave blank for random URL, or set your own to reuse
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between mb-3">
            <label className="block text-sm font-medium text-gray-300">
              Enter your text or code
            </label>
            <button
              onClick={handleCopy}
              disabled={!inputText}
              className="bg-indigo-600/50 hover:bg-indigo-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded transition-colors flex items-center gap-2 text-sm whitespace-nowrap"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy
                </>
              )}
            </button>
          </div>
          
          {loading && !inputText ? (
            <div className="flex items-center justify-center h-84 bg-gray-900 border-2 border-gray-600">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-400 mx-auto mb-4"></div>
                <p className="text-gray-400">Loading content...</p>
              </div>
            </div>
          ) : (
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Paste your code, text, or any content here...&#10;&#10;The more text you add, the better the compression ratio!"
              className="w-full h-84 p-4 bg-gray-900 border-2 border-gray-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none resize-none font-mono text-sm text-gray-100 placeholder-gray-500"
              disabled={loading}
            />
          )}
          
          <div className="flex items-center justify-between mt-2">
            <div className="text-sm text-gray-400">
              {inputText && `Current size: ${inputText.length.toLocaleString()} characters`}
              {compressionRatio && ` • Compressed to ${compressionRatio}% of original`}
            </div>
          </div>
          
          <button
            onClick={handleSend}
            disabled={!inputText.trim() || loading || !supabaseConfigured}
            className="mt-4 w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                {isUpdating ? 'Updating...' : 'Sharing...'}
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                {customUrl ? 'Update/Share' : 'Share'}
              </>
            )}
          </button>
        </div>

        <div className="mt-6 text-center text-xs text-gray-600 pb-4">
          <p className="mb-1">© 2025 breb - No rights reserved</p>
          <p className="text-gray-700">• copywrightbrothers@getsome •</p>
        </div>
      </div>
    </div>
  );
}