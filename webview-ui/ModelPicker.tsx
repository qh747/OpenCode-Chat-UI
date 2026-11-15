import { useEffect, useRef, useState } from "react";
import type { ModelInfo, ModelRef } from "../src/opencode/types";
import { groupModels, isFreeModel, modelShortName, providerDisplayName } from "../src/util/commands";
import { t } from "../src/util/i18n";

interface ModelPickerProps {
  models: ModelInfo[];
  recentModels: ModelRef[];
  activeModel?: ModelRef;
  onSelect: (ref: ModelRef) => void;
}

/** Desktop-style model picker: search, grouped sections, per-row effort flyout. */
export function ModelPicker({
  models,
  recentModels,
  activeModel,
  onSelect,
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
  const activeKey = activeModel ? keyOf(activeModel.providerID, activeModel.id) : undefined;
  const activeInfo = activeModel
    ? models.find((m) => activeKey === keyOf(m.providerID, m.modelID))
    : undefined;

  /** The variant currently in effect for a row, only when that row is the active model. */
  const variantOf = (key: string): string | undefined => (activeKey === key ? activeModel?.variant : undefined);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? models.filter((m) => m.name.toLowerCase().includes(q) || m.modelID.toLowerCase().includes(q))
    : models;
  const sections = groupModels(filtered, recentModels);

  const displayName = activeInfo?.name ?? activeModel?.id ?? t("modelFallback");

  return (
    <div className={`dropdown dropdown-wide model-picker${open ? " open" : ""}`} ref={rootRef}>
      <button className="dropdown-button" onClick={() => setOpen((c) => !c)} title={displayName}>
        {/* Two faces of the same picker. CSS shows exactly one, by container
            width, so the label degrades as the panel narrows. */}
        <span className="label-full">
          <span className="picker-provider">{activeModel ? providerDisplayName(activeModel.providerID) : ""}</span>
          {activeModel && <span className="picker-sep">/</span>}
          <span className="picker-model-name">{displayName}</span>
        </span>
        <span className="label-short">{modelShortName(displayName)}</span>
        <span className="dropdown-caret">▾</span>
      </button>
      {open && (
        <div className="dropdown-menu model-menu">
          <div className="model-search">
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("searchModels")}
            />
          </div>
          {/* activeModel guard kept for the rows below */}
          {sections.length === 0 && <div className="mention-empty">{t("noMatchingModels")}</div>}
          {sections.map((section) => (
            <div key={section.label}>
              <div className="dropdown-group">{section.label}</div>
              {section.models.map((model) => {
                const key = keyOf(model.providerID, model.modelID);
                const selected = activeModel ? keyOf(activeModel.providerID, activeModel.id) === key : false;
                const free = isFreeModel(model);
                const variants = model.variants ?? [];
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
                      {free && <span className="model-badge">{t("freeBadge")}</span>}
                      {variants.length > 0 && (
                        <span className="model-effort-hint">
                          {capitalize(variantOf(key) ?? "") || t("effortDefault")} ›
                        </span>
                      )}
                    </button>
                    {/* Variants expand in place rather than as a side flyout: the
                        menu scrolls, and a flyout past its right edge is clipped
                        by that scroll container in a narrow sidebar. */}
                    {hovered === key && variants.length > 0 && (
                      <div className="model-variants">
                        <button
                          className={`model-variant${!variantOf(key) ? " selected" : ""}`}
                          onClick={() => {
                            onSelect({ providerID: model.providerID, id: model.modelID });
                            setOpen(false);
                          }}
                        >
                          {t("effortDefault")}
                        </button>
                        {variants.map((variant) => (
                          <button
                            key={variant.id}
                            className={`model-variant${variantOf(key) === variant.id ? " selected" : ""}`}
                            onClick={() => {
                              onSelect({
                                providerID: model.providerID,
                                id: model.modelID,
                                variant: variant.id,
                              });
                              setOpen(false);
                            }}
                          >
                            {capitalize(variant.id)}
                          </button>
                        ))}
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

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
