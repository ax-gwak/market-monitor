import IntegratedMonitor from "@/components/IntegratedMonitor";

export default function Home() {
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Market Monitor</h1>
        <p style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>
          Integrated cycle phase · guide band · IR index
        </p>
      </div>
      <IntegratedMonitor />
    </main>
  );
}
