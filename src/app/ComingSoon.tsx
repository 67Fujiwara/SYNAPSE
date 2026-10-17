import { Card } from '@/components/ui/Card';
import { useT } from '@/i18n';

export function ComingSoon({ phase, nameKey }: { phase: number; nameKey: string }) {
  const { t } = useT();
  return (
    <Card className="mx-auto mt-10 max-w-md text-center">
      <h1 className="font-display text-2xl font-semibold">{t(nameKey)}</h1>
      <p className="mt-2 text-ink-2">Phase {phase}</p>
    </Card>
  );
}
