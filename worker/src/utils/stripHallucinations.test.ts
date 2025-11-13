import { describe, it, expect } from 'vitest';
import { stripHallucinations } from './stripHallucinations';

describe('stripHallucinations', () => {
  it('should remove "Thanks for watching" with period', () => {
    const input = 'This is my dictation. Thanks for watching.';
    const expected = 'This is my dictation.';
    expect(stripHallucinations(input)).toBe(expected);
  });

  it('should remove "Thanks for watching" with exclamation mark', () => {
    const input = 'This is my dictation. Thanks for watching!';
    const expected = 'This is my dictation.';
    expect(stripHallucinations(input)).toBe(expected);
  });

  it('should remove "Thank you for watching" variant', () => {
    const input = 'My text here. Thank you for watching.';
    const expected = 'My text here.';
    expect(stripHallucinations(input)).toBe(expected);
  });

  it('should remove "Don\'t forget to like and subscribe" with punctuation', () => {
    const input = 'Here is the content. Don\'t forget to like and subscribe!';
    const expected = 'Here is the content.';
    expect(stripHallucinations(input)).toBe(expected);
  });

  it('should remove "Subtitles by the Amara.org community"', () => {
    const input = 'Video transcript here. Subtitles by the Amara.org community.';
    const expected = 'Video transcript here.';
    expect(stripHallucinations(input)).toBe(expected);
  });

  it('should be case insensitive', () => {
    const input = 'Content here. THANKS FOR WATCHING!';
    const expected = 'Content here.';
    expect(stripHallucinations(input)).toBe(expected);
  });

  it('should handle multiple punctuation marks', () => {
    const input = 'My text. Thanks for watching...';
    const expected = 'My text.';
    expect(stripHallucinations(input)).toBe(expected);
  });

  it('should NOT remove phrase when it appears in the middle', () => {
    const input = 'Thanks for watching my presentation about the project.';
    const expected = 'Thanks for watching my presentation about the project.';
    expect(stripHallucinations(input)).toBe(expected);
  });

  it('should NOT remove "Don\'t forget to like and subscribe" when in middle of sentence', () => {
    const input = 'Don\'t forget to like and subscribe to my newsletter for updates.';
    const expected = 'Don\'t forget to like and subscribe to my newsletter for updates.';
    expect(stripHallucinations(input)).toBe(expected);
  });

  it('should handle text without hallucinations', () => {
    const input = 'This is normal dictation text.';
    const expected = 'This is normal dictation text.';
    expect(stripHallucinations(input)).toBe(expected);
  });

  it('should handle empty string', () => {
    expect(stripHallucinations('')).toBe('');
  });

  it('should handle multiple stacked hallucinations', () => {
    const input = 'My content. Please subscribe. Thanks for watching!';
    const expected = 'My content.';
    expect(stripHallucinations(input)).toBe(expected);
  });

  it('should handle hallucination with various punctuation', () => {
    const input = 'Content here! Thanks for watching?!';
    const expected = 'Content here!';
    expect(stripHallucinations(input)).toBe(expected);
  });

  it('should handle "Please subscribe" variation', () => {
    const input = 'Great video. Please subscribe.';
    const expected = 'Great video.';
    expect(stripHallucinations(input)).toBe(expected);
  });
});
