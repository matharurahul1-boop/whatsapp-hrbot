import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width:          512,
          height:         512,
          background:     'linear-gradient(135deg, #00A884 0%, #128C7E 100%)',
          borderRadius:   112,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          position:       'relative',
        }}
      >
        {/* Glow ring */}
        <div style={{
          position:     'absolute',
          width:        290,
          height:       290,
          borderRadius: '50%',
          background:   'rgba(255,255,255,0.12)',
          display:      'flex',
        }} />
        {/* Lightning bolt */}
        <div style={{
          position:      'absolute',
          display:       'flex',
          flexDirection: 'column',
          alignItems:    'center',
          transform:     'rotate(-10deg)',
        }}>
          <div style={{
            width:        0,
            height:       0,
            borderLeft:  '74px solid transparent',
            borderRight: '32px solid transparent',
            borderBottom:'148px solid rgba(255,255,255,0.95)',
          }} />
          <div style={{
            width:        0,
            height:       0,
            borderLeft:  '32px solid transparent',
            borderRight: '74px solid transparent',
            borderTop:   '148px solid rgba(255,255,255,0.95)',
            marginTop:   '-20px',
          }} />
        </div>
      </div>
    ),
    { width: 512, height: 512 }
  );
}
