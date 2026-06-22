import { identityDisplayRows, recordingModeLabel } from '@/identity/display';
import type { Translator } from '@/i18n';
import type { IdentityBundle, RecordingMode } from '@/shared/types';
import { Button, Card, CardContent, CardHeader, EmptyState } from '@/ui/primitives';

/**
 * Shared identity card used by both the popup and the dashboard. `mode` is
 * optional — when absent the mode chip is simply omitted.
 */
export function IdentityPanel(props: {
  identity: IdentityBundle | undefined;
  mode?: RecordingMode | undefined;
  tr: Translator;
  compact?: boolean;
}) {
  const mode = props.mode ? recordingModeLabel(props.mode, props.tr) : null;
  const cardClass = props.compact ? 'identity-card compact' : 'identity-card';

  if (!props.identity) {
    return (
      <Card className={cardClass}>
        <CardHeader>
          <strong>{props.tr('identity.title')}</strong>
          {mode ? <span>{mode.label}</span> : null}
        </CardHeader>
        <CardContent>
          <EmptyState>{props.tr('identity.empty')}</EmptyState>
        </CardContent>
      </Card>
    );
  }

  const rows = identityDisplayRows(props.identity, props.tr);
  const groups = [...new Set(rows.map((row) => row.group))];
  return (
    <Card className={cardClass}>
      <CardHeader>
        <strong>{props.tr('identity.generatedTitle')}</strong>
        <span>{props.identity.identity_bundle_id}</span>
      </CardHeader>
      <CardContent className="identity-groups">
        {groups.map((group) => (
          <div className="identity-group" key={group}>
            <h3>{group}</h3>
            {rows
              .filter((row) => row.group === group)
              .map((row) => (
                <div className="identity-row" key={`${group}:${row.label}`}>
                  <span>{row.label}</span>
                  {row.href ? (
                    <a href={row.href} target="_blank" rel="noreferrer">
                      {row.value}
                    </a>
                  ) : (
                    <code>{row.value}</code>
                  )}
                  {row.copyable ? (
                    <Button
                      size="sm"
                      onClick={() => void navigator.clipboard.writeText(row.value)}
                    >
                      {props.tr('actions.copy')}
                    </Button>
                  ) : null}
                </div>
              ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
