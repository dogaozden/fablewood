/** A pickable option shown after the last page of a conversation. */
export interface DialogueChoice {
  label: string;
  /** returned by DialogueBox.run() when this option is chosen */
  value: string;
}

/**
 * One conversation: a speaker, one-or-more text pages (advanced with a keypress),
 * and an optional choice list shown after the final page. Pure data — reusable by
 * any scene, not just the hamlet.
 */
export interface Conversation {
  speaker?: string;
  pages: string[];
  choices?: DialogueChoice[];
}
