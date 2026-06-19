import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width:          192,
          height:         192,
          background:     'linear-gradient(135deg, #00A884 0%, #128C7E 100%)',
          borderRadius:   42,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          position:       'relative',
        }}
      >
        {/* Glow ring */}
        <div style={{
          position:     'absolute',
          width:        110,
          height:       110,
          borderRadius: '50%',
          background:   'rgba(255,255,255,0.12)',
          display:      'flex',
        }} />
        {/* Lightning bolt using overlapping rectangles */}
        <div style={{
          position:  'absolute',
          display:   'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap:        0,
          transform: 'rotate(-10deg)',
        }}>
          <div style={{
            width:              0,
            height:             0,
            borderLeft:        '28px solid transparent',
            borderRight:       '12px solid transparent',
            borderBottom:      '56px solid rgba(255,255,255,0.95)',
          }} />
          <div style={{
            width:              0,
            height:             0,
            borderLeft:        '12px solid transparent',
            borderRight:       '28px solid transparent',
            borderTop:         '56px solid rgba(255,255,255,0.95)',
            marginTop:         '-8px',
          }} />
        </div>
      </div>
    ),
    { width: 192, height: 192 }
  );
}
