import React, { useState } from "react";
import { useVocabulary } from "../hooks/useVocabulary";
import SettingsCard from "./SettingsCard";
import IconButton from "./ui/IconButton";

/**
 * The vocabulary list: an add-word input followed by one row per saved word,
 * each with a reveal-on-hover trash. Returns a fragment so the rows slot into
 * the bordered group container that draws the shared borders (like ModelsList).
 */
const VocabularySettings: React.FC = () => {
  const { dictionary, addWord, removeWord } = useVocabulary();
  const [draft, setDraft] = useState("");

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    addWord(trimmed);
    setDraft("");
  };

  return (
    <>
      <div className="p-3 border-0 border-b border-white/[0.08]">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="add a word or name"
          aria-label="Add a word"
          className="w-full bg-transparent text-xs font-medium leading-4 text-white placeholder:text-subtle focus:outline-none no-drag"
        />
        <p className="text-[10px] text-subtle mt-0.5">
          Words and names Spoke should recognize correctly
        </p>
      </div>

      {dictionary.map((word) => (
        <SettingsCard key={word} title={word} inGroup>
          <span>
            <IconButton
              name="trash"
              onClick={() => removeWord(word)}
              title="Remove"
              ariaLabel={`Remove ${word}`}
              revealOnHover
            />
          </span>
        </SettingsCard>
      ))}
    </>
  );
};

export default VocabularySettings;
