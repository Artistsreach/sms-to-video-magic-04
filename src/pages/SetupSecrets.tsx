import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const SetupSecrets = () => {
  return (
    <div className="container mx-auto py-8 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Twilio Bot Setup Required</CardTitle>
          <CardDescription>
            Please configure the following secrets in your Supabase Edge Functions to enable the Twilio video generation bot.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="font-semibold mb-2">Required Secrets:</h3>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li><strong>TWILIO_ACCOUNT_SID</strong> - Your Twilio Account SID</li>
              <li><strong>TWILIO_AUTH_TOKEN</strong> - Your Twilio Auth Token</li>
              <li><strong>TWILIO_PHONE_NUMBER</strong> - Your Twilio phone number (e.g., +1234567890)</li>
              <li><strong>GOOGLE_CLOUD_PROJECT_ID</strong> - Your Google Cloud Project ID</li>
              <li><strong>GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY</strong> - Your Google Cloud Service Account JSON key</li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold mb-2">Workflow:</h3>
            <ol className="list-decimal list-inside space-y-1 text-sm">
              <li>User sends an image to your Twilio number</li>
              <li>Bot receives image and asks "How would you like to animate this image?"</li>
              <li>User responds with animation prompt</li>
              <li>Bot generates video using Google's Veo 3 model</li>
              <li>Bot sends completed video back to user</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SetupSecrets;