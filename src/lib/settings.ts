import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// Define the settings interface
interface AppSettings {
  hotkey: string;
  hideTimeout?: number; // For future "hide for X time" feature
}

// Default settings
const DEFAULT_SETTINGS: AppSettings = {
  hotkey: 'CommandOrControl+Space',
  hideTimeout: 3600000 // 1 hour in milliseconds
};

// Path to the settings file
const SETTINGS_PATH = path.join(
  app.getPath('userData'),
  'settings.json'
);

/**
 * Load settings from disk
 * Creates default settings file if it doesn't exist
 */
export function loadSettings(): AppSettings {
  try {
    // Check if settings file exists
    if (!fs.existsSync(SETTINGS_PATH)) {
      // Create default settings file
      fs.writeFileSync(
        SETTINGS_PATH,
        JSON.stringify(DEFAULT_SETTINGS, null, 2)
      );
      return { ...DEFAULT_SETTINGS };
    }

    // Read and parse settings file
    const data = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    const settings = JSON.parse(data) as AppSettings;
    
    // Ensure all required fields exist (in case of corrupted settings)
    return { ...DEFAULT_SETTINGS, ...settings };
  } catch (error) {
    console.error('Failed to load settings:', error);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Save settings to disk
 */
export function saveSettings(settings: AppSettings): boolean {
  try {
    fs.writeFileSync(
      SETTINGS_PATH,
      JSON.stringify(settings, null, 2)
    );
    return true;
  } catch (error) {
    console.error('Failed to save settings:', error);
    return false;
  }
}

/**
 * Update a specific setting
 */
export function updateSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): boolean {
  try {
    const settings = loadSettings();
    settings[key] = value;
    return saveSettings(settings);
  } catch (error) {
    console.error(`Failed to update setting ${key}:`, error);
    return false;
  }
}

/**
 * Validate if a hotkey string is in the correct format
 */
export function isValidHotkey(hotkey: string): boolean {
  // Basic validation - should contain at least one modifier
  const modifiers = ['Alt', 'Shift', 'Ctrl', 'Command', 'Option', 'Super'];
  return modifiers.some(modifier => hotkey.includes(modifier)) && 
         hotkey.includes('+');
} 