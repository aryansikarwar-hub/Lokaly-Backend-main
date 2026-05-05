const CoHost = require('../models/CoHost');
const CoHostBooking = require('../models/CoHostBooking');

// Calculate karma score based on performance
exports.updateKarmaScore = async (coHostId) => {
  const coHost = await CoHost.findById(coHostId);
  if (!coHost) return;
  
  const totalBookings = coHost.totalBookings || 1;
  const completionRate = (coHost.completedBookings / totalBookings) * 100;
  const cancellationPenalty = (coHost.cancelledBookings / totalBookings) * 30;
  
  // Karma formula: rating(40%) + completion(40%) + experience(20%) - penalty
  const karmaScore = Math.min(100, Math.max(0,
    (coHost.rating * 8) +              // out of 40
    (completionRate * 0.4) +            // out of 40
    Math.min(20, coHost.streamsHosted / 10) - // out of 20
    cancellationPenalty
  ));
  
  coHost.karmaScore = Math.round(karmaScore);
  await coHost.save();
  return coHost.karmaScore;
};

// Update rating after review
exports.updateRating = async (coHostId, newRating) => {
  const coHost = await CoHost.findById(coHostId);
  const totalReviews = coHost.totalReviews + 1;
  const updatedRating = ((coHost.rating * coHost.totalReviews) + newRating) / totalReviews;
  
  coHost.rating = parseFloat(updatedRating.toFixed(1));
  coHost.totalReviews = totalReviews;
  await coHost.save();
  
  await exports.updateKarmaScore(coHostId);
  return coHost;
};