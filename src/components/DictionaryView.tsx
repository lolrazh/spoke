import React, { useState, useRef } from "react";
import { motion } from "framer-motion";
import DateGroup from "./DateGroup";
import IconButton from "./ui/IconButton";
import { useVocabulary } from "../hooks/useVocabulary";
import { panelCascadeContainer, panelCascadeItem } from "./shared/panelMotion";

// Shared with the add-row so an in-progress edit reads as the same typed text
// as the word it replaces.
const INPUT_CLASS =
  "w-full bg-transparent text-xs text-foreground/80 leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none no-drag";

interface DictionaryRowProps {
  word: string;
  onEdit: (oldWord: string, newWord: string) => void;
  onRemove: (word: string) => void;
}

const DictionaryRowInner: React.FC<DictionaryRowProps> = ({
  word,
  onEdit,
  onRemove,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(word);
  // Enter unmounts the input, which can also fire blur — guard so a single edit
  // commits once, not twice.
  const committedRef = useRef(false);

  const startEdit = () => {
    setDraft(word);
    committedRef.current = false;
    setIsEditing(true);
  };

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = draft.trim();
    if (trimmed && trimmed !== word) onEdit(word, trimmed);
    setIsEditing(false);
  };

  const cancel = () => {
    committedRef.current = true;
    setDraft(word);
    setIsEditing(false);
  };

  return (
    <motion.div
      variants={panelCascadeItem}
      className="group flex border-b border-white/[0.08] hover:bg-white/5 transition-colors cursor-default"
    >
      <div className="flex-1 p-3 pr-2">
        {isEditing ? (
          <input
            type="text"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            onBlur={commit}
            aria-label={`Edit ${word}`}
            className={INPUT_CLASS}
          />
        ) : (
          <p className="text-xs text-foreground/80 leading-relaxed font-normal">
            {word}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3 px-3 min-w-[48px]">
        {!isEditing && (
          <>
            <IconButton
              name="pencil"
              onClick={startEdit}
              title="Edit"
              ariaLabel={`Edit ${word}`}
              revealOnHover
            />
            <IconButton
              name="trash"
              onClick={() => onRemove(word)}
              title="Remove"
              ariaLabel={`Remove ${word}`}
              revealOnHover
            />
          </>
        )}
      </div>
    </motion.div>
  );
};

const DictionaryRow = React.memo(DictionaryRowInner);

const DictionaryView: React.FC = () => {
  const { dictionary, addWord, removeWord, editWord } = useVocabulary();
  const [draft, setDraft] = useState("");

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    addWord(trimmed);
    setDraft("");
  };

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={panelCascadeContainer}
    >
      <DateGroup label="Vocabulary">
        {/* First slot in the list: the add-word input, same height/padding as
            the word rows so it reads as part of the list, not a header. */}
        <motion.div
          variants={panelCascadeItem}
          className="flex border-b border-white/[0.08]"
        >
          <div className="flex-1 p-3 pr-2 flex items-center gap-2">
            <span className="text-xs text-muted-foreground/50 select-none">
              +
            </span>
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
              placeholder="Add a word or name"
              aria-label="Add a word"
              className={INPUT_CLASS}
            />
          </div>
        </motion.div>

        {dictionary.map((word) => (
          <DictionaryRow
            key={word}
            word={word}
            onEdit={editWord}
            onRemove={removeWord}
          />
        ))}
      </DateGroup>
    </motion.div>
  );
};

export default DictionaryView;
