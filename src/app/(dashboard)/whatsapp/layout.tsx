/**
 * Layout override for /whatsapp — removes the default p-4/p-6/p-8 padding
 * so the WhatsApp interface fills edge-to-edge inside the main area.
 */
export default function WhatsAppLayout({ children }: { children: React.ReactNode }) {
  return (
    // Bust out of the default padded wrapper — give WA full height
    <div style={{ margin: '-2rem', height: 'calc(100vh - 56px)' }}>
      {children}
    </div>
  );
}
