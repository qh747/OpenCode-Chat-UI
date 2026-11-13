export interface ChipInput {
  path: string;
  name?: string;
  image?: boolean;
}

export interface ComposerHandle {
  setChips: (items: ChipInput[]) => void;
  setPromptText: (text: string) => void;
}
