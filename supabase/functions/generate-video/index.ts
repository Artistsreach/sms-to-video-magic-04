import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
Deno.serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    const { conversationId } = await req.json();
    // Get conversation details
    const { data: conversation, error: convError } = await supabase.from('conversations').select('*').eq('id', conversationId).single();
    if (convError || !conversation) {
      throw new Error('Conversation not found');
    }
    if (!conversation.image_url || !conversation.video_prompt) {
      throw new Error('Missing image or prompt');
    }
    console.log('Generating video for conversation:', conversationId);
    console.log('Image URL:', conversation.image_url);
    // Download image and convert to base64
    const imageResponse = await fetch(conversation.image_url);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download image: ${imageResponse.status} ${imageResponse.statusText}`);
    }
    const imageBlob = await imageResponse.blob();
    console.log('Image blob size:', imageBlob.size, 'type:', imageBlob.type);
    // Validate image
    if (imageBlob.size === 0) {
      throw new Error('Downloaded image is empty');
    }
    if (imageBlob.size > 10 * 1024 * 1024) {
      throw new Error('Image too large (max 10MB)');
    }
    // Check if it's a valid image type for Veo 3 (only JPEG and PNG)
    const validTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png'
    ];
    if (!validTypes.includes(imageBlob.type)) {
      throw new Error(`Invalid image type: ${imageBlob.type}. Veo 3 supports only: image/jpeg, image/png`);
    }
    const imageBuffer = await imageBlob.arrayBuffer();
    // More efficient base64 encoding for large images
    const uint8Array = new Uint8Array(imageBuffer);
    const chunkSize = 8192;
    let binary = '';
    for(let i = 0; i < uint8Array.length; i += chunkSize){
      const chunk = uint8Array.slice(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    const imageBase64 = btoa(binary);
    console.log('Image converted to base64, length:', imageBase64.length);
    // Get Google Cloud credentials
    const projectId = Deno.env.get('GOOGLE_CLOUD_PROJECT_ID');
    const serviceAccountKey = Deno.env.get('GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY');
    const credentials = JSON.parse(serviceAccountKey);
    // Get access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: await createJWT(credentials)
      })
    });
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    // Generate video with Veo 3
    const veoRequest = {
      instances: [
        {
          prompt: conversation.video_prompt,
          image: {
            bytesBase64Encoded: imageBase64,
            mimeType: imageBlob.type // Use actual detected MIME type
          }
        }
      ],
      parameters: {
        sampleCount: 1,
        aspectRatio: '16:9',
        resolution: '720p',
        storageUri: `gs://${projectId}-dreamr-videos/`
      }
    };
    const veoResponse = await fetch(`https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/veo-3.0-generate-preview:predictLongRunning`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(veoRequest)
    });
    const veoData = await veoResponse.json();
    if (!veoData.name) {
      throw new Error('Failed to start video generation');
    }
    const operationId = veoData.name.split('/').pop();
    // Update conversation with operation ID
    await supabase.from('conversations').update({
      operation_id: operationId,
      state: 'generating_video'
    }).eq('id', conversationId);
    // Start polling for completion
    EdgeRuntime.waitUntil(pollVideoGeneration(conversationId, veoData.name, accessToken, projectId));
    console.log('Video generation started, operation:', operationId);
    return new Response(JSON.stringify({
      success: true,
      operationId
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error generating video:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
async function createJWT(credentials) {
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };
  // Encode header and payload
  const encodedHeader = btoa(JSON.stringify(header)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const encodedPayload = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  // Process private key
  const privateKeyPem = credentials.private_key.replace(/\\n/g, '\n');
  const pemBody = privateKeyPem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s/g, '');
  // Decode base64 private key
  const binaryKey = Uint8Array.from(atob(pemBody), (c)=>c.charCodeAt(0));
  const privateKey = await crypto.subtle.importKey('pkcs8', binaryKey, {
    name: 'RSASSA-PKCS1-v1_5',
    hash: 'SHA-256'
  }, false, [
    'sign'
  ]);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(signatureInput));
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${signatureInput}.${encodedSignature}`;
}
async function pollVideoGeneration(conversationId, operationName, initialAccessToken, projectId) {
  const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  console.log('Starting video polling for conversation:', conversationId);
  const maxPolls = 60 // 30 minutes max
  ;
  let pollCount = 0;
  let currentAccessToken = initialAccessToken;
  while(pollCount < maxPolls){
    await new Promise((resolve)=>setTimeout(resolve, 30000)) // Wait 30 seconds
    ;
    pollCount++;
    console.log(`Polling attempt ${pollCount}/${maxPolls} for conversation ${conversationId}`);
    try {
      // Refresh token every 10 polls (5 minutes) to avoid expiration
      if (pollCount % 10 === 0) {
        console.log('Refreshing access token');
        const serviceAccountKey = Deno.env.get('GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY');
        const credentials = JSON.parse(serviceAccountKey);
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: await createJWT(credentials)
          })
        });
        const tokenData = await tokenResponse.json();
        currentAccessToken = tokenData.access_token;
        console.log('Access token refreshed');
      }
      const statusResponse = await fetch(`https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/veo-3.0-generate-preview:fetchPredictOperation`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${currentAccessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          operationName
        })
      });
      if (!statusResponse.ok) {
        console.error('Status response error:', statusResponse.status, await statusResponse.text());
        continue;
      }
      const statusData = await statusResponse.json();
      console.log('Status check result:', JSON.stringify(statusData, null, 2));
      if (statusData.done) {
        if (statusData.response?.videos?.[0]?.gcsUri) {
          // Video generation completed successfully
          const videoGcsUri = statusData.response.videos[0].gcsUri;
          console.log('Video generated successfully at:', videoGcsUri);
          // Download video from GCS and upload to Supabase Storage
          const videoUrl = await downloadAndStoreVideo(videoGcsUri, conversationId, currentAccessToken);
          console.log('Video uploaded to Supabase:', videoUrl);
          // Update conversation
          await supabase.from('conversations').update({
            video_url: videoUrl,
            state: 'completed'
          }).eq('id', conversationId);
          // Send completion message via Twilio
          await sendCompletionMessage(conversationId, videoUrl);
          console.log('Video generation process completed successfully');
          break;
        } else {
          // Generation failed
          console.error('Video generation failed - no video in response:', statusData);
          await supabase.from('conversations').update({
            state: 'failed'
          }).eq('id', conversationId);
          await sendErrorMessage(conversationId);
          break;
        }
      } else {
        console.log('Video still generating...');
      }
    } catch (error) {
      console.error('Error polling video status (attempt', pollCount, '):', error);
      // If we've exhausted all attempts, mark as failed
      if (pollCount >= maxPolls) {
        console.error('Max polling attempts reached, marking as failed');
        await supabase.from('conversations').update({
          state: 'failed'
        }).eq('id', conversationId);
        await sendErrorMessage(conversationId);
        break;
      }
    }
  }
  console.log('Polling ended for conversation:', conversationId);
}
async function downloadAndStoreVideo(gcsUri, conversationId, accessToken) {
  const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  // Convert GCS URI to download URL
  const bucketPath = gcsUri.replace('gs://', '');
  const downloadUrl = `https://storage.googleapis.com/${bucketPath}`;
  const videoResponse = await fetch(downloadUrl, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  const videoBlob = await videoResponse.blob();
  const fileName = `${conversationId}-${Date.now()}.mp4`;
  const { data: uploadData, error: uploadError } = await supabase.storage.from('videos').upload(fileName, videoBlob, {
    contentType: 'video/mp4'
  });
  if (uploadError) {
    throw new Error('Failed to upload video to storage');
  }
  const { data: publicUrlData } = supabase.storage.from('videos').getPublicUrl(fileName);
  return publicUrlData.publicUrl;
}
async function sendCompletionMessage(conversationId, videoUrl) {
  const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  const { data: conversation } = await supabase.from('conversations').select('phone_number').eq('id', conversationId).single();
  if (!conversation) return;
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
  const fromNumber = Deno.env.get('TWILIO_PHONE_NUMBER');
  const message = `🎬 Your video is ready! Watch it here: ${videoUrl}\n\nSend me another image to create more videos!`;
  // First try to send with video as MMS
  try {
    const mmsResponse = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        From: fromNumber,
        To: conversation.phone_number,
        Body: message,
        MediaUrl: videoUrl
      })
    });
    const mmsResult = await mmsResponse.json();
    if (mmsResponse.ok) {
      console.log('Video MMS sent successfully for conversation:', conversationId);
      return;
    } else {
      console.log('MMS failed, trying text message. Error:', mmsResult.message);
    }
  } catch (error) {
    console.log('MMS attempt failed, trying text message. Error:', error);
  }
  // Fallback: Send just the text message with URL
  try {
    const textResponse = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        From: fromNumber,
        To: conversation.phone_number,
        Body: message
      })
    });
    if (textResponse.ok) {
      console.log('Video URL text message sent successfully for conversation:', conversationId);
    } else {
      const textResult = await textResponse.json();
      console.error('Text message also failed:', textResult.message);
    }
  } catch (error) {
    console.error('Text message fallback failed:', error);
  }
  // Reset conversation for next use
  await supabase.from('conversations').update({
    state: 'waiting_for_image',
    image_url: null,
    video_prompt: null,
    video_url: null,
    operation_id: null
  }).eq('id', conversationId);
}
async function sendErrorMessage(conversationId) {
  const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  const { data: conversation } = await supabase.from('conversations').select('phone_number').eq('id', conversationId).single();
  if (!conversation) return;
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
  const fromNumber = Deno.env.get('TWILIO_PHONE_NUMBER');
  const message = 'Sorry, there was an error generating your video. Please try again with a new image.';
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      From: fromNumber,
      To: conversation.phone_number,
      Body: message
    })
  });
  // Reset conversation
  await supabase.from('conversations').update({
    state: 'waiting_for_image',
    image_url: null,
    video_prompt: null,
    video_url: null,
    operation_id: null
  }).eq('id', conversationId);
}