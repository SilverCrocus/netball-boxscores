import { SimPanel } from './SimPanel';

export default function SimAdminPage() {
  if (process.env.SIMULATION_MODE !== 'true') {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-headline font-bold text-on-surface">
            Simulation Disabled
          </h1>
          <p className="text-on-surface-variant">
            Set <code className="bg-surface-container px-2 py-1 rounded">SIMULATION_MODE=true</code> to enable.
          </p>
        </div>
      </div>
    );
  }

  return <SimPanel />;
}
