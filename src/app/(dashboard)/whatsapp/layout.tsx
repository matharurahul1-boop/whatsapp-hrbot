/**
 * Layout override for /whatsapp — removes the default p-4/p-6/p-8 padding
 * so the WhatsApp interface fills edge-to-edge inside the main area.
 */
export default function WhatsAppLayout({ children }: { children: React.ReactNode }) {
  return (
    // Bust out of the padded wrapper — margins cancel p-4/p-6/p-8 + pb-24
    // Height stops above the bottom nav on mobile, full on desktop
    <div className="-mx-4 -mt-4 -mb-24 md:-mx-6 md:-mt-6 md:-mb-24 lg:-m-8 wa-height-shell">
      {children}
    </div>
  );
}
