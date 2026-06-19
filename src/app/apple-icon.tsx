import { ImageResponse } from 'next/og';

export const runtime     = 'edge';
export const size        = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width:          '100%',
          height:         '100%',
          background:     'linear-gradient(135deg, #00A884 0%, #128C7E 100%)',
          borderRadius:   36,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          position:       'relative',
        }}
      >
        {/* Outer glow ring */}
        <div style={{
          position:     'absolute',
          width:        110,
          height:       110,
          borderRadius: '50%',
          background:   'rgba(255,255,255,0.12)',
        }} />
        {/* Lightning bolt - top polygon */}
        <div style={{
          position:     'absolute',
          width:        0,
          height:       0,
          borderLeft:   '24px solid transparent',
          borderRight:  '10px solid transparent',
          borderBottom: '50px solid white',
          top:          34,
          left:         72,
          opacity:      0.95,
        }} />
        {/* Lightning bolt - bottom polygon */}
        <div style={{
          position:     'absolute',
          width:        0,
          height:       0,
          borderLeft:   '10px solid transparent',
          borderRight:  '24px solid transparent',
          borderTop:    '50px solid white',
          bottom:       34,
          right:        72,
          opacity:      0.95,
        }} />
        {/* Center connector */}
        <div style={{
          position:     'absolute',
          width:        48,
          height:       12,
          background:   'white',
          top:          84,
          left:         66,
          opacity:      0.95,
          transform:    'rotate(-25deg)',
        }} />
      </div>
    ),
    { ...size }
  );
}
