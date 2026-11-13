import { useEffect, useRef, useState } from "react";
import type { ModelInfo, ModelRef } from "../src/opencode/types";
import { groupModels, isFreeModel, providerDisplayName } from "../src/util/commands";

interface ModelPickerProps {
  models: ModelInfo[];
  recentModels: ModelRef[];
  favoriteModels: ModelRef[];
  activeModel?: ModelRef;
  onSelect: (ref: ModelRef) => void;
  onToggleFavorite: (ref: ModelRef) => void;
}

/** Desktop-style model picker: search, grouped sections, per-row effort flyout. */
export function ModelPicker({
  models,
  recentModels,
  favoriteModels,
  activeModel,
  onSelect,
  onToggleFavorite,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [hovered, setHovered] = useState<string | undefined>();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setHovered(undefined);
      return;
    }
    const onOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const keyOf = (providerID: string, modelId: string) => `${providerID}/${modelId}`;
  const activeVariantOf = (key: string): string | undefined =>
    activeModel && keyOf(activeModel.providerID, activeModel.id) === key ? activeModel.variant : undefined;
  const activeInfo = activeModel
    ? models.find((m) => activeModel && keyOf(activeModel.providerID, activeModel.id) === keyOf(m.providerID, m.modelID))
    : undefined;

  const q = search.trim().toLowerCase();
  const filtered = q
    ? models.filter((m) => m.name.toLowerCase().includes(q) || m.modelID.toLowerCase().includes(q))
    : models;
  const sections = groupModels(filtered, recentModels);

  const flyoutFor = (model: ModelInfo): { variants: { id: string; label: string }[]; meta: string; favorite: boolean } => ({
    variants: (model.variants ?? []).map((v) => ({ id: v.id, label: capitalize(v.id) })),
    meta: metaLine(model),
    favorite: favoriteModels.some((f) => keyOf(f.providerID, f.id) === keyOf(model.providerID, model.modelID)),
  });

  return (
    <div className={`dropdown dropdown-wide${open ? " open" : ""}`} ref={rootRef}>
      <button className="dropdown-button" onClick={() => setOpen((c) => !c)} title={activeInfo?.name ?? "Model"}>
        <span className="dropdown-label">
          <span className="picker-provider">{activeModel ? providerDisplayName(activeModel.providerID) : ""}</span>
          {activeModel && <span className="picker-sep">/</span>}
          <span className="picker-model-name">{activeInfo?.name ?? activeModel?.id ?? "Model"}</span>
        </span>
        <span className="dropdown-caret">▾</span>
      </button>
      {open && (
        <div className="dropdown-menu model-menu">
          <div className="model-search">
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索模型"
            />
          </div>
          {/* activeModel guard kept for the rows below */}
          {sections.length === 0 && <div className="mention-empty">没有匹配的模型</div>}
          {sections.map((section) => (
            <div key={section.label}>
              <div className="dropdown-group">{section.label}</div>
              {section.models.map((model) => {
                const key = keyOf(model.providerID, model.modelID);
                const selected = activeModel ? keyOf(activeModel.providerID, activeModel.id) === key : false;
                const free = isFreeModel(model);
                return (
                  <div
                    key={key}
                    className="model-row-wrap"
                    onMouseEnter={() => setHovered(key)}
                    onMouseLeave={() => setHovered((current) => (current === key ? undefined : current))}
                  >
                    <button
                      className={`model-row${selected ? " selected" : ""}`}
                      onClick={() => {
                        onSelect({ providerID: model.providerID, id: model.modelID });
                        setOpen(false);
                      }}
                    >
                      <span className="model-check">{selected ? "✓" : ""}</span>
                      <span className="model-name">{model.name}</span>
                      <span className="model-provider">{providerDisplayName(model.providerID)}</span>
                      {free && <span className="model-badge">免费</span>}
                      {(model.variants?.length ?? 0) > 0 && (
                        <span className="model-effort-hint">默认 ›</span>
                      )}
                    </button>
                    {hovered === key && (
                      <div className="model-flyout">
                        <button
                          className={`dropdown-item${!activeVariantOf(key) ? " selected" : ""}`}
                          onClick={() => {
                            onSelect({ providerID: model.providerID, id: model.modelID });
                            setOpen(false);
                          }}
                        >
                          Default
                        </button>
                        {flyoutFor(model).variants.map((variant) => (
                          <button
                            key={variant.id}
                            className={`dropdown-item${activeVariantOf(key) === variant.id ? " selected" : ""}`}
                            onClick={() => {
                              onSelect({ providerID: model.providerID, id: model.modelID, variant: variant.id });
                              setOpen(false);
                            }}
                          >
                            {variant.label}
                          </button>
                        ))}
                        <button
                          className="dropdown-item"
                          onClick={() => onToggleFavorite({ providerID: model.providerID, id: model.modelID })}
                        >
                          {flyoutFor(model).favorite ? "Unfavorite" : "Favorite"}
                        </button>
                        <div className="model-meta">{flyoutFor(model).meta}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function metaLine(model: ModelInfo): string {
  const parts: string[] = [providerDisplayName(model.providerID)];
  const context = model.limit?.context;
  if (context && context > 0) {
    parts.push(context >= 10_000 ? `${Math.round(context / 10_000)}万 context` : `${context} context`);
  }
  if (model.capabilities?.tools) {
    parts.push("TextTools");
  }
  return parts.join(" · ");
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
