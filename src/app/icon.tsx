import { ImageResponse } from 'next/og';

export const runtime     = 'edge';          // edge runtime avoids the Node canvas issue
export const size        = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width:           '100%',
          height:          '100%',
          borderRadius:    '50%',
          background:      '#00A884',
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
        }}
      >
        <div
          style={{
            width:        16,
            height:       16,
            borderRadius: '50% 50% 0 50%',
            background:   '#ffffff',
          }}
        />
      </div>
    ),
    { width: 32, height: 32 }
  );
}
