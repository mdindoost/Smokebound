/**
 * The history page (SPEC §2, REDTEAM F7).
 *
 * Required, not decorative: an app that borrows signal fire owes the practices
 * it borrows from a plain, unpatronising credit — and the research is a
 * credibility asset rather than a liability. No iconography of any people
 * appears anywhere in this app; this page is where the debt is stated.
 */

import { Body, Card, Screen, Small, Title } from '../src/design/components';
import { HISTORY_NOTE } from '../src/lib/copy';

export default function History() {
  return (
    <Screen>
      <Title>Where this comes from</Title>
      <Card>
        <Body tone="soft">{HISTORY_NOTE}</Body>
      </Card>
      <Small tone="faint">
        If you keep one of these traditions and something here reads wrongly, we would rather
        hear it than not: moderation@smokebound.app.
      </Small>
    </Screen>
  );
}
