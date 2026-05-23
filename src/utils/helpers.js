// src/utils/helpers.js — Utility helpers for NexMeet

// Get initials from a display name (e.g. "John Doe" -> "JD")
export function getInitials(name) {
  if (!name) return '?';
  return name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// Generate a consistent gradient based on name
export function getAvatarGradient(name) {
  const gradients = [
    'linear-gradient(135deg, #63b3ed, #4299e1)',
    'linear-gradient(135deg, #9f7aea, #805ad5)',
    'linear-gradient(135deg, #68d391, #48bb78)',
    'linear-gradient(135deg, #fc8181, #e53e3e)',
    'linear-gradient(135deg, #f6ad55, #ed8936)',
    'linear-gradient(135deg, #76e4f7, #0bc5ea)',
    'linear-gradient(135deg, #b794f4, #9f7aea)',
    'linear-gradient(135deg, #fbb6ce, #ed64a6)',
  ];
  if (!name) return gradients[0];
  const index = name.charCodeAt(0) % gradients.length;
  return gradients[index];
}

// Format milliseconds into mm:ss
export function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

// Format a timestamp into a readable chat time (e.g. "3:45 PM")
export function formatChatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Copy text to clipboard
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    return true;
  }
}

// Show a toast notification
export function showNotification(message, type = 'info', duration = 3500) {
  const container = document.getElementById('notifications');
  if (!container) return;

  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };

  const el = document.createElement('div');
  el.className = `notification ${type}`;
  el.innerHTML = `<span>${icons[type] || 'ℹ️'}</span> ${message}`;
  container.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s ease';
    setTimeout(() => el.remove(), 300);
  }, duration);
}