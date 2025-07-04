import User from "../models/User.js";
import FriendRequest from "../models/FriendRequest.js";
import mongoose from "mongoose";

export async function getRecommendedUsers(req, res) {
  try {
    const currentUserId = req.user.id;
    
    // Get current user with friends populated
    const currentUser = await User.findById(currentUserId)
      .select("friends")
      .lean();

    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const friendIds = currentUser.friends.map(id => id.toString());
    friendIds.push(currentUserId);

    const recommendedUsers = await User.find({
      _id: { $nin: friendIds },
      isOnboarded: true
    }).select("fullName profilePic nativeLanguage learningLanguage");

    res.status(200).json(recommendedUsers);
  } catch (error) {
    console.error("Error in getRecommendedUsers", error);
    res.status(500).json({ message: "Server error" });
  }
}

export async function getMyFriends(req, res) {
  try {
    const user = await User.findById(req.user.id)
      .select("friends")
      .populate("friends", "fullName profilePic nativeLanguage learningLanguage")
      .lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(user.friends || []);
  } catch (error) {
    console.error("Error in getMyFriends", error);
    res.status(500).json({ message: "Server error" });
  }
}

export async function sendFriendRequest(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const myId = req.user.id;
    const { id: recipientId } = req.params;

    // Validate IDs
    if (!mongoose.Types.ObjectId.isValid(recipientId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    if (myId === recipientId) {
      return res.status(400).json({ message: "Cannot send request to yourself" });
    }

    // Check if users exist
    const [currentUser, recipient] = await Promise.all([
      User.findById(myId).select("friends").session(session),
      User.findById(recipientId).select("friends").session(session)
    ]);

    if (!currentUser || !recipient) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check existing friendship
    if (
      currentUser.friends.includes(recipientId) || 
      recipient.friends.includes(myId)
    ) {
      return res.status(400).json({ message: "Already friends" });
    }

    // Check existing requests
    const existingRequest = await FriendRequest.findOne({
      $or: [
        { sender: myId, recipient: recipientId },
        { sender: recipientId, recipient: myId },
      ]
    }).session(session);

    if (existingRequest) {
      return res.status(400).json({ 
        message: existingRequest.status === "pending" 
          ? "Request already pending" 
          : "Already connected"
      });
    }

    // Create new request
    const friendRequest = await FriendRequest.create([{
      sender: myId,
      recipient: recipientId,
    }], { session });

    await session.commitTransaction();
    res.status(201).json(friendRequest[0]);
  } catch (error) {
    await session.abortTransaction();
    console.error("Error in sendFriendRequest", error);
    res.status(500).json({ message: "Server error" });
  } finally {
    session.endSession();
  }
}

export async function acceptFriendRequest(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id: requestId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(requestId)) {
      return res.status(400).json({ message: "Invalid request ID" });
    }

    // Find and validate request
    const friendRequest = await FriendRequest.findById(requestId).session(session);
    
    if (!friendRequest) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (friendRequest.recipient.toString() !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    if (friendRequest.status !== "pending") {
      return res.status(400).json({ message: "Request already processed" });
    }

    // Update request status
    friendRequest.status = "accepted";
    await friendRequest.save({ session });

    // Update both users
    const updateOperations = [
      User.findByIdAndUpdate(
        friendRequest.sender,
        { $addToSet: { friends: friendRequest.recipient } },
        { session, new: true }
      ),
      User.findByIdAndUpdate(
        friendRequest.recipient,
        { $addToSet: { friends: friendRequest.sender } },
        { session, new: true }
      )
    ];

    await Promise.all(updateOperations);
    await session.commitTransaction();

    res.status(200).json({ message: "Request accepted" });
  } catch (error) {
    await session.abortTransaction();
    console.error("Error in acceptFriendRequest", error);
    res.status(500).json({ message: "Server error" });
  } finally {
    session.endSession();
  }
}

export async function getFriendRequests(req, res) {
  try {
    const userId = req.user.id;
    
    const [incomingReqs, acceptedReqs] = await Promise.all([
      FriendRequest.find({
        recipient: userId,
        status: "pending"
      }).populate("sender", "fullName profilePic nativeLanguage learningLanguage"),
      
      FriendRequest.find({
        $or: [
          { sender: userId, status: "accepted" },
          { recipient: userId, status: "accepted" }
        ]
      })
      .populate([
        { 
          path: "sender", 
          select: "fullName profilePic",
          match: { _id: { $ne: userId } }
        },
        { 
          path: "recipient", 
          select: "fullName profilePic",
          match: { _id: { $ne: userId } }
        }
      ])
      .lean()
    ]);

    // Filter out null populated fields
    const filteredAcceptedReqs = acceptedReqs.filter(req => 
      req.sender !== null && req.recipient !== null
    );

    res.status(200).json({ 
      incomingReqs, 
      acceptedReqs: filteredAcceptedReqs 
    });
  } catch (error) {
    console.error("Error in getFriendRequests", error);
    res.status(500).json({ message: "Server error" });
  }
}

export async function getOutgoingFriendReqs(req, res) {
  try {
    const outgoingRequests = await FriendRequest.find({
      sender: req.user.id,
      status: "pending"
    }).populate("recipient", "fullName profilePic nativeLanguage learningLanguage");

    res.status(200).json(outgoingRequests);
  } catch (error) {
    console.error("Error in getOutgoingFriendReqs", error);
    res.status(500).json({ message: "Server error" });
  }
}