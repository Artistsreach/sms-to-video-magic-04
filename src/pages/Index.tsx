import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Phone, Video, Image, MessageSquare } from "lucide-react";

const Index = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 p-6">
      <div className="container mx-auto max-w-4xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold text-gray-900">
            Dreamr - AI Video Generation Bot
          </h1>
          <p className="text-lg text-gray-600">
            Send an image via SMS, get an AI-generated video back using Google's Veo 3
          </p>
        </div>

        {/* Workflow Cards */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="text-center">
            <CardHeader className="pb-4">
              <div className="mx-auto w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-2">
                <Image className="w-6 h-6 text-blue-600" />
              </div>
              <CardTitle className="text-lg">1. Send Image</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                Text an image to your Twilio number
              </p>
            </CardContent>
          </Card>

          <Card className="text-center">
            <CardHeader className="pb-4">
              <div className="mx-auto w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-2">
                <MessageSquare className="w-6 h-6 text-green-600" />
              </div>
              <CardTitle className="text-lg">2. Describe Animation</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                Reply with how you want to animate the image
              </p>
            </CardContent>
          </Card>

          <Card className="text-center">
            <CardHeader className="pb-4">
              <div className="mx-auto w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-2">
                <Video className="w-6 h-6 text-purple-600" />
              </div>
              <CardTitle className="text-lg">3. AI Generation</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                Google's Veo 3 creates your video
              </p>
            </CardContent>
          </Card>

          <Card className="text-center">
            <CardHeader className="pb-4">
              <div className="mx-auto w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center mb-2">
                <Phone className="w-6 h-6 text-orange-600" />
              </div>
              <CardTitle className="text-lg">4. Receive Video</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                Get your animated video via SMS
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Setup Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Setup Status
              <Badge variant="secondary">Ready</Badge>
            </CardTitle>
            <CardDescription>
              Your Twilio bot is configured and ready to receive messages
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Webhook Endpoints:</h3>
              <div className="bg-gray-50 p-3 rounded-lg text-sm font-mono">
                <p><strong>Twilio Webhook:</strong> https://inrveiaulksfmzsbyzqj.supabase.co/functions/v1/twilio-webhook</p>
                <p><strong>Video Generation:</strong> https://inrveiaulksfmzsbyzqj.supabase.co/functions/v1/generate-video</p>
              </div>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Required Secrets (Configured):</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Badge variant="outline">TWILIO_ACCOUNT_SID</Badge>
                <Badge variant="outline">TWILIO_AUTH_TOKEN</Badge>
                <Badge variant="outline">TWILIO_PHONE_NUMBER</Badge>
                <Badge variant="outline">GOOGLE_CLOUD_PROJECT_ID</Badge>
                <Badge variant="outline">GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Instructions */}
        <Card>
          <CardHeader>
            <CardTitle>Setup Instructions</CardTitle>
            <CardDescription>
              To complete the setup, configure your Twilio webhook
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Twilio Configuration:</h3>
              <ol className="list-decimal list-inside space-y-2 text-sm">
                <li>Go to your Twilio Console</li>
                <li>Navigate to Phone Numbers → Manage → Active Numbers</li>
                <li>Click on your Twilio phone number</li>
                <li>In the Messaging section, set the webhook URL to:</li>
                <div className="bg-gray-50 p-2 rounded font-mono text-xs mt-1">
                  https://inrveiaulksfmzsbyzqj.supabase.co/functions/v1/twilio-webhook
                </div>
                <li>Set HTTP method to POST</li>
                <li>Save the configuration</li>
              </ol>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Index;
