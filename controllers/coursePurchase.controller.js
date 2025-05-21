import Stripe from "stripe";
import { Course } from "../models/course.model.js";
import { CoursePurchase } from "../models/coursePurchase.model.js";
import { Lecture } from "../models/lecture.model.js";
import { User } from "../models/user.model.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// create checkout session
export const createCheckoutSession = async (req, res) => {
  try {
    const userId = req.id;
    const { courseId } = req.body;

    if (!courseId) {
      return res.status(400).json({ message: "Course ID is required" });
    }

    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ message: "Course not found!" });

    // Check if user already has a pending or completed purchase for this course
    const existingPurchase = await CoursePurchase.findOne({
      courseId,
      userId,
      status: { $in: ["pending", "completed"] },
    });

    if (existingPurchase && existingPurchase.status === "completed") {
      return res.status(400).json({ message: "Course already purchased" });
    }

    // Create a new course purchase record with status pending
    const newPurchase = new CoursePurchase({
      courseId,
      userId,
      amount: course.coursePrice,
      status: "pending",
    });

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "inr",
            product_data: {
              name: course.courseTitle,
              images: [course.courseThumbnail],
            },
            unit_amount: course.coursePrice * 100, // paise
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.FRONTEND_URL}/course-progress/${courseId}`, // environment variable for frontend URL
      cancel_url: `${process.env.FRONTEND_URL}/course-detail/${courseId}`,
      metadata: {
        courseId,
        userId,
      },
      shipping_address_collection: {
        allowed_countries: ["IN"],
      },
    });

    if (!session.url) {
      return res.status(400).json({
        success: false,
        message: "Error while creating session",
      });
    }

    // Save paymentId from session
    newPurchase.paymentId = session.id;
    await newPurchase.save();

    return res.status(200).json({
      success: true,
      url: session.url,
    });
  } catch (error) {
    console.error("createCheckoutSession error:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// Stripe webhook handler
export const stripeWebhook = async (req, res) => {
  let event;

  try {
    const secret = process.env.WEBHOOK_ENDPOINT_SECRET;

    // IMPORTANT: req.rawBody required for webhook signature verification
    const sig = req.headers["stripe-signature"];

    if (!sig) {
      return res.status(400).send("Missing Stripe signature header");
    }

    event = stripe.webhooks.constructEvent(req.rawBody, sig, secret);
  } catch (error) {
    console.error("Webhook signature verification failed:", error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  if (event.type === "checkout.session.completed") {
    console.log("Checkout session completed event received");

    try {
      const session = event.data.object;

      const purchase = await CoursePurchase.findOne({
        paymentId: session.id,
      }).populate("courseId");

      if (!purchase) {
        console.warn("Purchase not found for paymentId:", session.id);
        return res.status(404).json({ message: "Purchase not found" });
      }

      // If already completed, ignore duplicate event
      if (purchase.status === "completed") {
        return res.status(200).send("Already processed");
      }

      // Update purchase record
      if (session.amount_total) {
        purchase.amount = session.amount_total / 100;
      }
      purchase.status = "completed";

      // IMPORTANT: Unlock only lectures marked for preview (or implement your own logic)
      // For now, only unlock lectures if not already unlocked
      if (purchase.courseId && purchase.courseId.lectures.length > 0) {
        await Lecture.updateMany(
          { _id: { $in: purchase.courseId.lectures }, isPreviewFree: false },
          { $set: { isPreviewFree: true } }
        );
      }

      await purchase.save();

      // Add course to user's enrolledCourses
      await User.findByIdAndUpdate(
        purchase.userId,
        { $addToSet: { enrolledCourses: purchase.courseId._id } },
        { new: true }
      );

      // Add user to course's enrolledStudents
      await Course.findByIdAndUpdate(
        purchase.courseId._id,
        { $addToSet: { enrolledStudents: purchase.userId } },
        { new: true }
      );
    } catch (error) {
      console.error("Error processing checkout.session.completed:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  }

  res.status(200).send("Received");
};

// Get course detail with purchase status
export const getCourseDetailWithPurchaseStatus = async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.id;

    if (!courseId) {
      return res.status(400).json({ message: "Course ID required" });
    }

    const course = await Course.findById(courseId)
      .populate("creator")
      .populate("lectures");

    if (!course) {
      return res.status(404).json({ message: "Course not found!" });
    }

    const purchased = await CoursePurchase.findOne({ userId, courseId });

    return res.status(200).json({
      course,
      purchased: !!purchased,
    });
  } catch (error) {
    console.error("getCourseDetailWithPurchaseStatus error:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// Get all purchased courses
export const getAllPurchasedCourse = async (req, res) => {
  try {
    const purchasedCourses = await CoursePurchase.find({
      status: "completed",
    }).populate("courseId");

    // Return empty array if no purchases found
    return res.status(200).json({
      purchasedCourses,
    });
  } catch (error) {
    console.error("getAllPurchasedCourse error:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};
