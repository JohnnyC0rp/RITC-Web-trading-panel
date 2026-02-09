/**
 * MnaPairsSection renders dual-chart merger pair cards.
 * Search anchors:
 * - "mna-pair-select" for pair picker wiring
 * - "mna-peer-toggle" for default-reference visibility controls
 */
export default function MnaPairsSection({
  activePairIds,
  pairOptions,
  pairById,
  onAddPair,
  onRemovePair,
  onChangePair,
  canAddPair,
  isPeerPriceVisible,
  onPeerPriceToggle,
  renderTickerChart,
}) {
  return (
    <div className="mna-pairs">
      <div className="mna-pairs-toolbar">
        <strong className="mna-toolbar-title">Pairs</strong>
        <span className="muted mna-toolbar-note">
          Add/remove pair cards independently. New cards are appended at the end.
        </span>
        <button type="button" className="ghost small" onClick={onAddPair} disabled={!canAddPair}>
          Add Pair
        </button>
      </div>

      <div className="mna-pairs-list">
        {activePairIds.map((pairId, index) => {
          const pair = pairById.get(pairId) || pairOptions[0];
          if (!pair) return null;
          const chartPairs = [
            { ticker: pair.targetTicker },
            { ticker: pair.acquirerTicker },
          ];
          return (
            <article key={`${pair.id}-${index}`} className="mna-pair-card">
              <div className="mna-pair-header">
                <label className="mna-pair-select">
                  <span>Pair</span>
                  <select
                    value={pair.id}
                    onChange={(event) => onChangePair(index, event.target.value)}
                  >
                    {pairOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="mna-chip">{pair.sector}</span>
                <span className="mna-chip">{pair.structureLabel}</span>
                {activePairIds.length > 1 && (
                  <button
                    type="button"
                    className="ghost small"
                    onClick={() => onRemovePair(index)}
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="mna-pair-description">{pair.description}</div>
              <div className="mna-chart-grid">
                {chartPairs.map(({ ticker }) => (
                  <div key={`${pair.id}-${ticker}`} className="mna-chart-panel">
                    <div className="mna-chart-panel-header">
                      <strong>{ticker}</strong>
                      <label className="checkbox-row mna-peer-toggle">
                        <input
                          type="checkbox"
                          checked={isPeerPriceVisible(pair.id, ticker)}
                          onChange={(event) =>
                            onPeerPriceToggle(pair.id, ticker, event.target.checked)
                          }
                        />
                        Show default reference prices
                      </label>
                    </div>
                    {renderTickerChart({ pair, ticker })}
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
